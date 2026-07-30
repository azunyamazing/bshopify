import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { RunnerConfig } from "#/app/runner/types";
import { isNodeError } from "#/utils/node";
import { isInsidePath } from "#/utils/paths";
import { readExtensionNames } from "./checks";
import { extensionEntryTemplate } from "./constants";
import {
  createContentHash,
  getGeneratedEntryContentHash,
  isGeneratedEntry,
} from "./extension-entry-content";
import { writeFileIfMissing } from "./files";
import {
  recordExtensionEntry,
  type InitManifest,
} from "./manifest";
import { resolveProjectPath, toDisplayPath } from "./paths";
import type { InitResult } from "./types";

export async function writeExtensionEntries(
  cwd: string,
  result: InitResult,
  config: RunnerConfig,
  cleanupStaleGeneratedEntries: boolean,
  manifest?: InitManifest,
): Promise<void> {
  const extensionNames = await readExtensionNames(cwd, config.extensionsRoot);
  if (cleanupStaleGeneratedEntries && manifest !== undefined) {
    pruneRemovedExtensionEntries(result, config, extensionNames, manifest);
  }

  for (const extensionName of extensionNames) {
    const entryPath = join(config.extensionsRoot, extensionName, config.entryFileName);
    const absoluteEntryPath = resolveProjectPath(cwd, entryPath);
    const wasTracked = manifest?.extensionEntries[extensionName] !== undefined;
    const staleEntryResult = cleanupStaleGeneratedEntries
      ? await reconcileStaleExtensionEntry(cwd, result, config, extensionName, manifest)
      : { shouldRecordTarget: true, shouldWriteTarget: true };
    let created = false;

    if (staleEntryResult.shouldWriteTarget) {
      created = await writeFileIfMissing(cwd, entryPath, extensionEntryTemplate, result);
      if (!created && cleanupStaleGeneratedEntries) {
        await updateManagedGeneratedExtensionEntry(cwd, result, entryPath, extensionName, manifest);
      }
    } else if (cleanupStaleGeneratedEntries) {
      await updateManagedGeneratedExtensionEntry(cwd, result, entryPath, extensionName, manifest);
    }

    if (
      manifest !== undefined
      && staleEntryResult.shouldRecordTarget
      && await shouldRecordExtensionEntry(absoluteEntryPath, created, wasTracked)
    ) {
      recordExtensionEntry(
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
      result.warnings.push(`custom extension entry left unmanaged: ${entryPath}`);
    }
  }
}

function pruneRemovedExtensionEntries(
  result: InitResult,
  config: RunnerConfig,
  extensionNames: string[],
  manifest: InitManifest,
): void {
  const currentExtensions = new Set(extensionNames);

  for (const extensionName of Object.keys(manifest.extensionEntries)) {
    if (currentExtensions.has(extensionName)) {
      continue;
    }

    delete manifest.extensionEntries[extensionName];
    result.updated.push(
      `removed stale manifest entry ${join(config.extensionsRoot, extensionName)}`,
    );
  }
}

interface StaleEntryResult {
  shouldRecordTarget: boolean;
  shouldWriteTarget: boolean;
}

async function reconcileStaleExtensionEntry(
  cwd: string,
  result: InitResult,
  config: RunnerConfig,
  extensionName: string,
  manifest: InitManifest | undefined,
): Promise<StaleEntryResult> {
  const targetPath = join(cwd, config.extensionsRoot, extensionName, config.entryFileName);
  const stalePath = collectStaleExtensionEntryPath(cwd, result, config, extensionName, manifest);

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
        result.updated.push(`removed stale generated entry ${toDisplayPath(cwd, stalePath)}`);
        if (!(await isGeneratedEntry(targetPath))) {
          delete manifest?.extensionEntries[extensionName];
          result.warnings.push(`custom extension entry left unmanaged: ${toDisplayPath(cwd, targetPath)}`);
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

      result.warnings.push(`custom stale entry left in place: ${toDisplayPath(cwd, stalePath)}`);
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
  result.updated.push(
    `renamed extension entry ${toDisplayPath(cwd, stalePath)} -> ${toDisplayPath(cwd, targetPath)}`,
  );
  return {
    shouldRecordTarget: true,
    shouldWriteTarget: false,
  };
}

function collectStaleExtensionEntryPath(
  cwd: string,
  result: InitResult,
  config: RunnerConfig,
  extensionName: string,
  manifest: InitManifest | undefined,
): string | undefined {
  const manifestPath = manifest?.extensionEntries[extensionName]?.path;

  if (manifestPath === undefined) {
    return undefined;
  }

  const targetPath = join(config.extensionsRoot, extensionName, config.entryFileName);
  if (manifestPath === targetPath) {
    return undefined;
  }

  if (isAbsolute(manifestPath)) {
    result.warnings.push(`ignored manifest entry outside extension directory: ${manifestPath}`);
    return undefined;
  }

  const stalePath = resolveProjectPath(cwd, manifestPath);
  const extensionRoot = resolveProjectPath(cwd, join(config.extensionsRoot, extensionName));
  if (!isInsidePath(extensionRoot, stalePath)) {
    result.warnings.push(`ignored manifest entry outside extension directory: ${manifestPath}`);
    return undefined;
  }

  return stalePath;
}

async function shouldRecordExtensionEntry(
  path: string,
  created: boolean,
  wasTracked: boolean,
): Promise<boolean> {
  return created || wasTracked || await isGeneratedEntry(path);
}

async function updateManagedGeneratedExtensionEntry(
  cwd: string,
  result: InitResult,
  entryPath: string,
  extensionName: string,
  manifest: InitManifest | undefined,
): Promise<void> {
  const previousHash = manifest?.extensionEntries[extensionName]?.contentHash;
  if (previousHash === undefined) {
    return;
  }

  const absoluteEntryPath = resolveProjectPath(cwd, entryPath);
  const current = await readFile(absoluteEntryPath, "utf8");
  if (current === extensionEntryTemplate || createContentHash(current) !== previousHash) {
    return;
  }

  await writeFile(absoluteEntryPath, extensionEntryTemplate);
  result.updated.push(`updated generated extension entry ${entryPath}`);
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
