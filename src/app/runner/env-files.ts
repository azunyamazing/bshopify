import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { loadTomlConfig } from "#/utils/config";
import { isNodeError } from "#/utils/node";
import { isRecord } from "#/utils/objects";
import { ansi, colorize } from "#/utils/output";
import type { EnvFilesConfig } from "./types";

/** One loaded `envFiles` namespace: merged contents plus the paths that actually loaded. */
export interface EnvFileNamespace {
  contents: Record<string, unknown>;
  paths: string[];
}

export type EnvFileNamespaces = Record<string, EnvFileNamespace>;

export interface EnvFilesLoadResult {
  namespaces: EnvFileNamespaces;
  warnings: string[];
}

/**
 * Loads every `envFiles` namespace from `bshopify.config.mjs`: each key maps
 * to one or more root-relative JSON/TOML files whose contents are merged
 * (later files win on duplicate keys) into the namespace exposed on the
 * runner context as `ctx.<key>`. A missing file is reported as a warning and
 * skipped — the key keeps whatever the remaining files loaded (empty object
 * when none). No console output is emitted here; callers own presentation.
 */
export async function loadEnvNamespaces(
  cwd: string,
  envFiles: EnvFilesConfig,
): Promise<EnvFilesLoadResult> {
  const namespaces: EnvFileNamespaces = {};
  const warnings: string[] = [];

  for (const [key, paths] of Object.entries(envFiles)) {
    const loaded = await loadEnvNamespace(cwd, key, toPathList(paths));
    namespaces[key] = loaded.namespace;
    warnings.push(...loaded.warnings);
  }

  return { namespaces, warnings };
}

function toPathList(paths: string | string[]): string[] {
  return Array.isArray(paths) ? paths : [paths];
}

async function loadEnvNamespace(
  cwd: string,
  key: string,
  paths: string[],
): Promise<{ namespace: EnvFileNamespace; warnings: string[] }> {
  const contents: Record<string, unknown> = {};
  const loadedPaths: string[] = [];
  const warnings: string[] = [];

  for (const path of paths) {
    const loaded = await loadEnvFile(cwd, key, path);

    if (loaded === undefined) {
      warnings.push(`bshopify envFiles.${key} ${path} does not exist; skipped.`);
      continue;
    }

    loadedPaths.push(path);
    Object.assign(contents, loaded);
  }

  return { namespace: { contents, paths: loadedPaths }, warnings };
}

async function loadEnvFile(
  cwd: string,
  key: string,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  const targetPath = join(cwd, path);

  try {
    await access(targetPath, constants.F_OK);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  const parsed = await parseEnvFile(targetPath, path);

  if (!isRecord(parsed)) {
    throw new Error(`bshopify envFiles.${key} ${path} must be a JSON/TOML object.`);
  }

  return parsed;
}

async function parseEnvFile(targetPath: string, displayPath: string): Promise<unknown> {
  const extension = extname(targetPath);

  if (extension === ".toml") {
    try {
      return await loadTomlConfig(targetPath);
    } catch (error) {
      throw new Error(`bshopify envFiles ${displayPath} is not valid TOML: ${formatError(error)}`);
    }
  }

  if (extension === ".json") {
    try {
      const raw = await readFile(targetPath, "utf8");
      return JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown;
    } catch (error) {
      throw new Error(`bshopify envFiles ${displayPath} is not valid JSON: ${formatError(error)}`);
    }
  }

  throw new Error(`bshopify envFiles ${displayPath} must be a .json or .toml file.`);
}

/**
 * Renders the "custom env files injected" hint for the configured namespaces:
 * one line per key listing the file paths that were actually loaded, or
 * "(none)" when every file for that key was missing.
 */
export function formatEnvFilesSummary(namespaces: EnvFileNamespaces): string | undefined {
  const entries = Object.entries(namespaces);

  if (entries.length === 0) {
    return undefined;
  }

  return [
    "",
    colorize(colorize("Custom env files injected", ansi.cyan), ansi.bold),
    ...entries.map(([key, namespace]) =>
      namespace.paths.length > 0
        ? `  ${colorize(key, ansi.cyan)} ${colorize("->", ansi.gray)} ${namespace.paths
            .map((path) => colorize(path, ansi.magenta))
            .join(", ")}`
        : `  ${colorize(key, ansi.cyan)} ${colorize("->", ansi.gray)} ${colorize("(none)", ansi.gray)}`,
    ),
    "",
  ].join("\n");
}

/** Command-layer helper: prints envFiles warnings and the injected-files hint. */
export function printEnvFilesOutput(
  summary: string | undefined,
  warnings: string[],
): void {
  for (const warning of warnings) {
    console.warn(colorize(warning, ansi.yellow));
  }

  if (summary !== undefined) {
    console.log(summary);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
