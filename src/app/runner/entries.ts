import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isNodeError } from "#/utils/node";
import { isRecord, toRequiredString } from "#/utils/objects";
import { toPosixPath } from "#/utils/paths";
import type {
  ExtensionContext,
  ExtensionEntry,
  ExtensionLifecycle,
  InjectionPlan,
  PreparedExtensionPlan,
  RunnerContextBase,
  RunnerConfig,
} from "./types";

export async function findExtensionEntries(
  cwd: string,
  config: RunnerConfig,
): Promise<ExtensionEntry[]> {
  const extensionsRoot = join(cwd, config.extensionsRoot);

  try {
    await stat(extensionsRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const entries = await readdir(extensionsRoot, { withFileTypes: true });
  const extensionEntries: ExtensionEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const extensionRoot = join(extensionsRoot, entry.name);
    const entryPath = join(extensionRoot, config.entryFileName);

    try {
      await stat(entryPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    extensionEntries.push({
      extension: {
        name: entry.name,
        root: extensionRoot,
      },
      filePath: entryPath,
    });
  }

  return extensionEntries.sort((left, right) =>
    left.extension.name.localeCompare(right.extension.name),
  );
}

export async function loadExtensionHooks(
  entries: ExtensionEntry[],
): Promise<PreparedExtensionPlan[]> {
  const hooks: PreparedExtensionPlan[] = [];

  for (const entry of entries) {
    const module = await import(`${pathToFileURL(entry.filePath).href}?t=${Date.now()}`);
    const lifecycle = module.default;

    if (!isLifecycle(lifecycle)) {
      throw new Error(
        `${toPosixPath(entry.filePath)} must export a lifecycle object with prepare(ctx).`,
      );
    }

    hooks.push({
      entry,
      extension: entry.extension.name,
      hooks: lifecycle,
      injections: [],
    });
  }

  return hooks;
}

export async function preparePlans(
  context: RunnerContextBase,
  hooks: PreparedExtensionPlan[],
): Promise<PreparedExtensionPlan[]> {
  const plans: PreparedExtensionPlan[] = [];

  for (const hook of hooks) {
    const extensionContext = createExtensionContext(context, hook.entry);
    const result = await hook.hooks.prepare(extensionContext);

    if (!isRecord(result) || !Array.isArray(result.injections)) {
      throw new Error(
        `${toPosixPath(hook.entry.filePath)} prepare(ctx) must return an injections array.`,
      );
    }

    plans.push({
      ...hook,
      extension: typeof result.extension === "string" ? result.extension : hook.extension,
      injections: result.injections.map((injection) => normalizeInjection(injection)),
    });
  }

  return plans;
}

export async function validatePlans(
  context: RunnerContextBase,
  plans: PreparedExtensionPlan[],
): Promise<void> {
  for (const plan of plans) {
    await plan.hooks.validate?.(createExtensionContext(context, plan.entry), plan, plans);
  }
}

function createExtensionContext(
  context: RunnerContextBase,
  entry: ExtensionEntry,
): ExtensionContext {
  return {
    ...context,
    extension: {
      name: entry.extension.name,
      root: toPosixPath(entry.extension.root),
    },
  };
}

function normalizeInjection(value: unknown): InjectionPlan {
  if (!isRecord(value)) {
    throw new Error("Injection entries must be objects.");
  }

  if (value.strategy !== "replace") {
    throw new Error(`Unsupported injection strategy: ${String(value.strategy)}`);
  }

  return {
    file: toRequiredString(value.file, "injection.file"),
    pattern: toRequiredString(value.pattern, "injection.pattern"),
    strategy: "replace",
    value: value.value,
  };
}

function isLifecycle(value: unknown): value is ExtensionLifecycle {
  return isRecord(value) && typeof value.prepare === "function";
}
