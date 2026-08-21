import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RunnerContextBase } from "#/app/runner/types";
import { isNodeError } from "#/utils/node";
import { isRecord, toRequiredString } from "#/utils/objects";
import { toPosixPath } from "#/utils/paths";
import { createExtensionContext } from "./context";
import { loadManagedEntryModule } from "./entry-loader";
import type {
  ExtensionDeployResult,
  ExtensionLifecycle,
  InjectionPlan,
  ManagedEntry,
  PreparedExtensionPlan,
} from "./types";

export interface ManagedEntryDiscoveryOptions {
  entryFileName: string;
  extensionsRoot: string;
}

/**
 * Discovers Shopify extension directories under the extensions root and
 * returns the bshopify-managed entry files that exist inside them.
 *
 * Discovery is split from `loadManagedEntryHooks` so the two concepts stay
 * distinct: extensions are Shopify artifacts, entry files are bshopify ones.
 */
export async function findManagedEntries(
  cwd: string,
  options: ManagedEntryDiscoveryOptions,
): Promise<ManagedEntry[]> {
  const extensionsRoot = join(cwd, options.extensionsRoot);

  try {
    await stat(extensionsRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const entries = await readdir(extensionsRoot, { withFileTypes: true });
  const managedEntries: ManagedEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const extensionRoot = join(extensionsRoot, entry.name);
    const entryPath = join(extensionRoot, options.entryFileName);

    try {
      await stat(entryPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    managedEntries.push({
      extension: {
        name: entry.name,
        root: extensionRoot,
      },
      filePath: entryPath,
    });
  }

  return managedEntries.sort((left, right) =>
    left.extension.name.localeCompare(right.extension.name),
  );
}

export async function loadManagedEntryHooks(
  entries: ManagedEntry[],
): Promise<PreparedExtensionPlan[]> {
  const hooks: PreparedExtensionPlan[] = [];

  for (const entry of entries) {
    const module = await loadManagedEntryModule(entry.filePath);
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

export async function runBeforeDeployHooks(
  context: RunnerContextBase,
  plans: PreparedExtensionPlan[],
): Promise<void> {
  for (const plan of plans) {
    await plan.hooks.beforeDeploy?.(createExtensionContext(context, plan.entry), plan, plans);
  }
}

export async function runAfterDeployHooks(
  context: RunnerContextBase,
  plans: PreparedExtensionPlan[],
  result: ExtensionDeployResult,
): Promise<void> {
  for (const plan of plans) {
    await plan.hooks.afterDeploy?.(createExtensionContext(context, plan.entry), result);
  }
}

export async function runOnErrorHooks(
  context: RunnerContextBase,
  plans: PreparedExtensionPlan[],
  error: unknown,
): Promise<void> {
  for (const plan of plans) {
    await plan.hooks.onError?.(createExtensionContext(context, plan.entry), error);
  }
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
