import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveExtensionPath } from "#/app/utils/extensions";
import { findFilesByExtension } from "#/utils/files";
import { createFileMarker } from "#/utils/markers";
import { formatPath } from "#/utils/paths";
import { ansi, colorize } from "#/utils/output";
import type { FileTransaction, PreparedExtensionPlan } from "./types";

const restoreMarkerPrefix = "bshopify-restore";
const unresolvedPlaceholderPattern = /__[A-Z0-9_]+__/g;

export interface ApplyInjectionsOptions {
  mode?: "deploy" | "dev" | "dryRun";
  restoreMarkers: boolean;
}

export interface AppliedInjection {
  path: string;
  pattern: string;
  value: string;
}

export interface FormatAppliedInjectionsOptions {
  configName?: string;
  cwd: string;
  mode?: "deploy" | "dev" | "dryRun";
}

interface AppliedInjectionGroup {
  injections: AppliedInjection[];
  path: string;
}

export async function applyInjections(
  cwd: string,
  plan: PreparedExtensionPlan,
  transaction: FileTransaction,
  options: ApplyInjectionsOptions,
): Promise<AppliedInjection[]> {
  const applied: AppliedInjection[] = [];
  const mode = options.mode ?? "dev";

  for (const injection of plan.injections) {
    if (injection.strategy !== "replace") {
      throw new Error(`Unsupported injection strategy: ${injection.strategy}`);
    }

    const targetPath = resolveExtensionPath(plan.entry.extension.root, injection.file);
    const pattern = injection.pattern.trim();
    const value = String(injection.value ?? "");

    if (!pattern) {
      throw new Error(`Injection pattern is required for ${formatPath(cwd, targetPath)}.`);
    }

    if (!value.trim()) {
      throw new Error(`${injection.pattern} has no value for ${formatInjectionErrorMode(mode)}.`);
    }

    const source = await readFile(targetPath, "utf8");
    const matchCount = source.split(pattern).length - 1;

    if (matchCount !== 1) {
      throw new Error(
        `${formatPath(cwd, targetPath)} expected exactly one "${pattern}" match, got ${matchCount}.`,
      );
    }

    const marker = options.restoreMarkers
      ? createFileMarker(targetPath, `${restoreMarkerPrefix}:${randomUUID()}`)
      : undefined;

    await transaction.writeFile(targetPath, source.replace(pattern, `${value}${marker ?? ""}`), {
      marker,
      pattern,
      value,
    });
    applied.push({
      path: targetPath,
      pattern,
      value,
    });
  }

  return applied;
}

function formatInjectionErrorMode(mode: "deploy" | "dev" | "dryRun"): string {
  if (mode === "dryRun") {
    return "deploy dry-run";
  }

  return mode;
}

export function formatAppliedInjections(
  applied: AppliedInjection[],
  options: FormatAppliedInjectionsOptions,
): string | undefined {
  if (applied.length === 0) {
    return undefined;
  }
  const mode = options.mode ?? "dev";

  return [
    "",
    colorize(colorize(formatInjectionTitle(mode), ansi.cyan), ansi.bold),
    `${colorize("Reason:", ansi.gray)} ${formatInjectionReason(mode, options.configName)}`,
    "",
    ...groupAppliedInjections(applied).flatMap((group, index) => [
      ...(index > 0 ? [""] : []),
      `${colorize(formatPath(options.cwd, group.path), ansi.cyan)}:`,
      ...group.injections.map(
        (injection) =>
          `    ${colorize(injection.pattern, ansi.yellow)} ${colorize("->", ansi.gray)} ${colorize(
            injection.value,
            ansi.magenta,
          )}`,
      ),
    ]),
    "",
  ].join("\n");
}

function formatInjectionTitle(mode: "deploy" | "dev" | "dryRun"): string {
  if (mode === "deploy") {
    return "Deploy extension injections";
  }

  if (mode === "dryRun") {
    return "Deploy dry-run extension injections";
  }

  return "Dev extension injections";
}

function formatInjectionReason(mode: "deploy" | "dev" | "dryRun", configName: string | undefined): string {
  if (mode === "deploy") {
    return `temporary values for ${formatShopifyAppCommand("deploy", configName)}; restored after deploy.`;
  }

  if (mode === "dryRun") {
    return `temporary values for deploy dry-run${formatConfigSuffix(configName)}; restored after validation.`;
  }

  return `temporary values for ${formatShopifyAppCommand("dev", configName)}; restored when dev exits.`;
}

function formatShopifyAppCommand(command: string, configName: string | undefined): string {
  return `shopify app ${command}${formatConfigSuffix(configName)}`;
}

function formatConfigSuffix(configName: string | undefined): string {
  return configName === undefined ? "" : ` --config ${configName}`;
}

function groupAppliedInjections(applied: AppliedInjection[]): AppliedInjectionGroup[] {
  const groups = new Map<string, AppliedInjectionGroup>();

  for (const injection of applied) {
    const group = groups.get(injection.path) ?? {
      injections: [],
      path: injection.path,
    };
    group.injections.push(injection);
    groups.set(injection.path, group);
  }

  return [...groups.values()];
}

export async function assertNoUnresolvedPlaceholders(
  cwd: string,
  extensionsRootName: string,
): Promise<void> {
  const extensionsRoot = join(cwd, extensionsRootName);
  const liquidFiles = await findFilesByExtension(extensionsRoot, ".liquid");
  const findings: string[] = [];

  for (const file of liquidFiles) {
    const content = await readFile(file, "utf8");
    const placeholders = [...new Set(content.match(unresolvedPlaceholderPattern) ?? [])];

    if (placeholders.length > 0) {
      findings.push(`${formatPath(cwd, file)}: ${placeholders.join(", ")}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(
      [
        "Unresolved deploy placeholders found after extension entry injection.",
        ...findings.map((finding) => `  - ${finding}`),
      ].join("\n"),
    );
  }
}
