import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bshopifyStateDir } from "#/app/runner/constants";
import { isNodeError } from "#/utils/node";
import { isRecord } from "#/utils/objects";
import { resolveProjectPath } from "./paths";

export const manifestFileName = "bshopify.manifest.json";

export interface InitManifest {
  cleanFilter?: InitManifestPath;
  configFile: string;
  entries: Record<string, InitManifestEntry>;
  gitignore: InitManifestGitignore;
  preCommitHook?: InitManifestPath;
  version: number;
}

export interface InitManifestEntry {
  contentHash?: string;
  path: string;
}

export interface InitManifestGitignore {
  path: string;
}

export interface InitManifestPath {
  path: string;
}

export async function loadInitManifest(cwd: string): Promise<InitManifest> {
  try {
    return normalizeManifest(JSON.parse(await readFile(getManifestPath(cwd), "utf8")));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return createEmptyManifest();
    }

    throw error;
  }
}

export async function saveInitManifest(
  cwd: string,
  manifest: InitManifest,
): Promise<void> {
  const targetPath = getManifestPath(cwd);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    `${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`,
  );
}

export function applyRunnerConfigToManifest(manifest: InitManifest): void {
  manifest.configFile = "bshopify.config.mjs";
  manifest.gitignore = {
    path: ".gitignore",
  };
}

export function recordPreCommitHook(manifest: InitManifest, path: string | undefined): void {
  if (path === undefined) {
    delete manifest.preCommitHook;
    return;
  }

  manifest.preCommitHook = { path };
}

export function recordCleanFilter(manifest: InitManifest, path: string): void {
  manifest.cleanFilter = { path };
}

function createEmptyManifest(): InitManifest {
  return {
    configFile: "bshopify.config.mjs",
    entries: {},
    gitignore: {
      path: ".gitignore",
    },
    version: 1,
  };
}

function getManifestPath(cwd: string): string {
  return resolveProjectPath(cwd, join(bshopifyStateDir, manifestFileName));
}

function normalizeManifest(value: unknown): InitManifest {
  if (!isRecord(value)) {
    return createEmptyManifest();
  }

  return {
    cleanFilter: normalizePathRecord(value.cleanFilter),
    configFile: typeof value.configFile === "string" ? value.configFile : "bshopify.config.mjs",
    entries: normalizeManagedEntries(
      isRecord(value.entries) ? value.entries : value.extensionEntries,
    ),
    gitignore: normalizeGitignore(value.gitignore),
    preCommitHook: normalizePathRecord(value.preCommitHook),
    version: 1,
  };
}

function normalizeManagedEntries(value: unknown): Record<string, InitManifestEntry> {
  if (!isRecord(value)) {
    return {};
  }

  const entries: Record<string, InitManifestEntry> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      continue;
    }

    entries[name] = {
      ...(typeof entry.contentHash === "string" ? { contentHash: entry.contentHash } : {}),
      path: entry.path,
    };
  }

  return entries;
}

function normalizeGitignore(value: unknown): InitManifestGitignore {
  if (isRecord(value)) {
    return {
      path: typeof value.path === "string" ? value.path : ".gitignore",
    };
  }

  return {
    path: ".gitignore",
  };
}

function normalizePathRecord(value: unknown): InitManifestPath | undefined {
  if (!isRecord(value) || typeof value.path !== "string") {
    return undefined;
  }

  return { path: value.path };
}
