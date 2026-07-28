import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveExtensionPath } from "#/app/utils/extensions";
import { findFilesByExtension } from "#/utils/files";
import { createFileMarker } from "#/utils/markers";
import { formatPath } from "#/utils/paths";
import type { FileTransaction, PreparedExtensionPlan } from "./types";

const restoreMarkerPrefix = "bshopify-restore";
const unresolvedPlaceholderPattern = /__[A-Z0-9_]+__/g;

export interface ApplyInjectionsOptions {
  restoreMarkers: boolean;
}

export async function applyInjections(
  cwd: string,
  plan: PreparedExtensionPlan,
  transaction: FileTransaction,
  options: ApplyInjectionsOptions,
): Promise<void> {
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
      throw new Error(`${injection.pattern} has no value for dev.`);
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
  }
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
