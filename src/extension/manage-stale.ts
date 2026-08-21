import { constants } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { isNodeError } from "#/utils/node";
import { formatPath, isInsidePath, resolvePath } from "#/utils/paths";
import { isGeneratedEntry } from "./manage-content";
import type {
  ManagedEntryChanges,
  ManagedEntryManifest,
  ManagedEntryOptions,
} from "./manage";

interface StaleEntryResult {
  shouldRecordTarget: boolean;
  shouldWriteTarget: boolean;
}

/**
 * Reconciles the configured entry name against a manifest-tracked entry from
 * an older configuration, renaming or removing stale managed entries.
 */
export async function reconcileStaleManagedEntry(
  cwd: string,
  changes: ManagedEntryChanges,
  options: ManagedEntryOptions,
  extensionName: string,
  manifest: ManagedEntryManifest | undefined,
): Promise<StaleEntryResult> {
  const targetPath = join(cwd, options.extensionsRoot, extensionName, options.entryFileName);
  const stalePath = collectStaleManagedEntryPath(cwd, changes, options, extensionName, manifest);

  if (stalePath === undefined) {
    return {
      shouldRecordTarget: true,
      shouldWriteTarget: true,
    };
  }

  if (await pathExists(targetPath)) {
    if (await pathExists(stalePath)) {
      if (await isGeneratedEntry(stalePath)) {
        await rm(stalePath);
        changes.updated.push(`removed stale generated entry ${formatPath(cwd, stalePath)}`);
        if (!(await isGeneratedEntry(targetPath))) {
          delete manifest?.entries[extensionName];
          changes.warnings.push(`custom extension entry left unmanaged: ${formatPath(cwd, targetPath)}`);
          return {
            shouldRecordTarget: false,
            shouldWriteTarget: false,
          };
        }

        return {
          shouldRecordTarget: true,
          shouldWriteTarget: false,
        };
      }

      changes.warnings.push(`custom stale entry left in place: ${formatPath(cwd, stalePath)}`);
      return {
        shouldRecordTarget: false,
        shouldWriteTarget: false,
      };
    }

    return {
      shouldRecordTarget: true,
      shouldWriteTarget: true,
    };
  }

  if (!(await pathExists(stalePath))) {
    return {
      shouldRecordTarget: true,
      shouldWriteTarget: true,
    };
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await rename(stalePath, targetPath);
  changes.updated.push(
    `renamed extension entry ${formatPath(cwd, stalePath)} -> ${formatPath(cwd, targetPath)}`,
  );
  return {
    shouldRecordTarget: true,
    shouldWriteTarget: false,
  };
}

function collectStaleManagedEntryPath(
  cwd: string,
  changes: ManagedEntryChanges,
  options: ManagedEntryOptions,
  extensionName: string,
  manifest: ManagedEntryManifest | undefined,
): string | undefined {
  const manifestPath = manifest?.entries[extensionName]?.path;

  if (manifestPath === undefined) {
    return undefined;
  }

  const targetPath = join(options.extensionsRoot, extensionName, options.entryFileName);
  if (manifestPath === targetPath) {
    return undefined;
  }

  if (isAbsolute(manifestPath)) {
    changes.warnings.push(`ignored manifest entry outside extension directory: ${manifestPath}`);
    return undefined;
  }

  const stalePath = resolvePath(cwd, manifestPath);
  const extensionRoot = resolvePath(cwd, join(options.extensionsRoot, extensionName));
  if (!isInsidePath(extensionRoot, stalePath)) {
    changes.warnings.push(`ignored manifest entry outside extension directory: ${manifestPath}`);
    return undefined;
  }

  return stalePath;
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
