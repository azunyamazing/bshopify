import { constants } from "node:fs";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileIfMissing } from "#/utils/files";
import { isNodeError } from "#/utils/node";
import { formatPath, resolvePath } from "#/utils/paths";
import {
  createContentHash,
  getGeneratedEntryContentHash,
  isGeneratedEntry,
  managedEntryTemplate,
} from "./manage-content";
import { reconcileStaleManagedEntry } from "./manage-stale";

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
  contentHash?: string;
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

export async function writeManagedEntries(
  cwd: string,
  changes: ManagedEntryChanges,
  options: ManagedEntryOptions,
  cleanupStaleGeneratedEntries: boolean,
  manifest?: ManagedEntryManifest,
): Promise<void> {
  const extensionNames = await readExtensionNames(cwd, options.extensionsRoot);
  if (cleanupStaleGeneratedEntries && manifest !== undefined) {
    pruneRemovedManagedEntries(changes, options, extensionNames, manifest);
  }

  for (const extensionName of extensionNames) {
    const entryPath = join(options.extensionsRoot, extensionName, options.entryFileName);
    const absoluteEntryPath = resolvePath(cwd, entryPath);
    const wasTracked = manifest?.entries[extensionName] !== undefined;
    const staleEntryResult = cleanupStaleGeneratedEntries
      ? await reconcileStaleManagedEntry(cwd, changes, options, extensionName, manifest)
      : { shouldRecordTarget: true, shouldWriteTarget: true };
    let created = false;

    if (staleEntryResult.shouldWriteTarget) {
      created = await writeFileIfMissing(cwd, entryPath, managedEntryTemplate, changes);
      if (!created && cleanupStaleGeneratedEntries) {
        await updateManagedGeneratedEntry(cwd, changes, entryPath, extensionName, manifest);
      }
    } else if (cleanupStaleGeneratedEntries) {
      await updateManagedGeneratedEntry(cwd, changes, entryPath, extensionName, manifest);
    }

    if (
      manifest !== undefined
      && staleEntryResult.shouldRecordTarget
      && await shouldRecordManagedEntry(absoluteEntryPath, created, wasTracked)
    ) {
      recordManagedEntry(
        manifest,
        extensionName,
        cwd,
        absoluteEntryPath,
        await getGeneratedEntryContentHash(absoluteEntryPath),
      );
    } else if (
      manifest !== undefined
      && staleEntryResult.shouldRecordTarget
      && await pathExists(absoluteEntryPath)
    ) {
      changes.warnings.push(`custom extension entry left unmanaged: ${entryPath}`);
    }
  }
}

function recordManagedEntry(
  manifest: ManagedEntryManifest,
  extensionName: string,
  cwd: string,
  absolutePath: string,
  contentHash?: string,
): void {
  manifest.entries[extensionName] = {
    ...(contentHash === undefined ? {} : { contentHash }),
    path: formatPath(cwd, absolutePath),
  };
}

function pruneRemovedManagedEntries(
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
      `removed stale manifest entry ${join(options.extensionsRoot, extensionName)}`,
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

async function updateManagedGeneratedEntry(
  cwd: string,
  changes: ManagedEntryChanges,
  entryPath: string,
  extensionName: string,
  manifest: ManagedEntryManifest | undefined,
): Promise<void> {
  const previousHash = manifest?.entries[extensionName]?.contentHash;
  if (previousHash === undefined) {
    return;
  }

  const absoluteEntryPath = resolvePath(cwd, entryPath);
  const current = await readFile(absoluteEntryPath, "utf8");
  if (current === managedEntryTemplate || createContentHash(current) !== previousHash) {
    return;
  }

  await writeFile(absoluteEntryPath, managedEntryTemplate);
  changes.updated.push(`updated generated extension entry ${entryPath}`);
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
