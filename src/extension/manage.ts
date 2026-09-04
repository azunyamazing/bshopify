import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeFileIfMissing } from "#/utils/files";
import { isNodeError } from "#/utils/node";
import { formatPath, resolvePath } from "#/utils/paths";
import { isGeneratedEntry, managedEntryTemplate } from "./manage-content";

/**
 * Minimal change-reporting surface the extension domain needs while managing
 * entry files. The init command's `InitResult` satisfies this structurally.
 */
export interface ManagedEntryChanges {
  created: string[];
  skipped: string[];
  updated: string[];
  warnings: string[];
}

export interface ManagedEntryRecord {
  path: string;
}

/**
 * Minimal manifest view the extension domain mutates while managing entries.
 * The init command's `InitManifest` satisfies this structurally.
 */
export interface ManagedEntryManifest {
  entries: Record<string, ManagedEntryRecord>;
}

export interface ManagedEntryOptions {
  entryFileName: string;
  extensionsRoot: string;
}

export async function readExtensionNames(
  cwd: string,
  extensionsRoot = "extensions",
): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, extensionsRoot), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

/**
 * Writes the managed entry for every current extension directory and records
 * tracked entries in the manifest. Missing entries are created from the
 * latest template; existing files are never overwritten. Manifest entries for
 * extensions that no longer exist are dropped (bookkeeping only — files on
 * disk are left untouched).
 */
export async function writeManagedEntries(
  cwd: string,
  changes: ManagedEntryChanges,
  options: ManagedEntryOptions,
  manifest?: ManagedEntryManifest,
): Promise<void> {
  const extensionNames = await readExtensionNames(cwd, options.extensionsRoot);

  if (manifest !== undefined) {
    pruneRemovedExtensionRecords(changes, options, extensionNames, manifest);
  }

  for (const extensionName of extensionNames) {
    const entryPath = join(options.extensionsRoot, extensionName, options.entryFileName);
    const absoluteEntryPath = resolvePath(cwd, entryPath);
    const wasTracked = manifest?.entries[extensionName] !== undefined;
    const created = await writeFileIfMissing(cwd, entryPath, managedEntryTemplate, changes);

    if (
      manifest !== undefined
      && await shouldRecordManagedEntry(absoluteEntryPath, created, wasTracked)
    ) {
      recordManagedEntry(manifest, extensionName, cwd, absoluteEntryPath);
    } else if (manifest !== undefined && await pathExists(absoluteEntryPath)) {
      changes.warnings.push(`custom extension entry left unmanaged: ${entryPath}`);
    }
  }
}

function recordManagedEntry(
  manifest: ManagedEntryManifest,
  extensionName: string,
  cwd: string,
  absolutePath: string,
): void {
  manifest.entries[extensionName] = {
    path: formatPath(cwd, absolutePath),
  };
}

function pruneRemovedExtensionRecords(
  changes: ManagedEntryChanges,
  options: ManagedEntryOptions,
  extensionNames: string[],
  manifest: ManagedEntryManifest,
): void {
  const currentExtensions = new Set(extensionNames);

  for (const extensionName of Object.keys(manifest.entries)) {
    if (currentExtensions.has(extensionName)) {
      continue;
    }

    delete manifest.entries[extensionName];
    changes.updated.push(
      `removed manifest entry for missing extension ${join(options.extensionsRoot, extensionName)}`,
    );
  }
}

async function shouldRecordManagedEntry(
  path: string,
  created: boolean,
  wasTracked: boolean,
): Promise<boolean> {
  return created || wasTracked || await isGeneratedEntry(path);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
