import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { isRecord } from "#/utils/objects";
import { isNodeError } from "#/utils/node";
import type { FileTransaction, HiddenFile, ReverseReplacement, TrackedFile } from "./types";

interface FileTransactionJournal {
  files: TrackedFile[];
  hiddenFiles: HiddenFile[];
}

export async function createFileTransaction(journalPath?: string): Promise<FileTransaction> {
  const tracked = new Map<string, TrackedFile>();
  const hiddenFiles: HiddenFile[] = [];

  return {
    async hideFile(path) {
      const hiddenFile = {
        hiddenPath: `${path}.bshopify-hidden-${randomUUID()}`,
        path,
      };
      hiddenFiles.push(hiddenFile);
      await writeJournal(journalPath, [...tracked.values()], hiddenFiles);
      await rename(hiddenFile.path, hiddenFile.hiddenPath);
    },
    async restore() {
      await restoreTrackedFiles([...tracked.values()]);
      await restoreHiddenFiles(hiddenFiles);

      if (journalPath !== undefined) {
        await rm(journalPath, { force: true });
      }
    },
    async writeFile(path, content, replacement) {
      const trackedFile = tracked.get(path) ?? { path, replacements: [] };
      trackedFile.replacements.push(replacement);
      tracked.set(path, trackedFile);
      await writeJournal(journalPath, [...tracked.values()], hiddenFiles);
      await writeFile(path, content);
    },
  };
}

export async function restoreFileTransactionJournal(journalPath: string): Promise<boolean> {
  const journal = await readJournal(journalPath);

  if (journal === undefined) {
    return false;
  }

  await restoreTrackedFiles(journal.files);
  await restoreHiddenFiles(journal.hiddenFiles);
  await rm(journalPath, { force: true });
  return true;
}

async function restoreTrackedFiles(files: TrackedFile[]): Promise<void> {
  for (const file of files.slice().reverse()) {
    let content = await readFile(file.path, "utf8");

    for (const replacement of file.replacements.slice().reverse()) {
      const restoreTarget =
        replacement.marker === undefined
          ? replacement.value
          : `${replacement.value}${replacement.marker}`;

      content = content.split(restoreTarget).join(replacement.pattern);
    }

    await writeFile(file.path, content);
  }
}

async function restoreHiddenFiles(files: HiddenFile[]): Promise<void> {
  for (const file of files.slice().reverse()) {
    try {
      await rename(file.hiddenPath, file.path);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }
}

async function writeJournal(
  journalPath: string | undefined,
  files: TrackedFile[],
  hiddenFiles: HiddenFile[],
): Promise<void> {
  if (journalPath === undefined) {
    return;
  }

  const journal: FileTransactionJournal = { files, hiddenFiles };
  await writeFile(journalPath, `${JSON.stringify(journal, undefined, 2)}\n`);
}

async function readJournal(journalPath: string): Promise<FileTransactionJournal | undefined> {
  let content;

  try {
    content = await readFile(journalPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  const value = JSON.parse(content) as unknown;

  if (!isRecord(value) || !Array.isArray(value.files)) {
    throw new Error("Invalid bshopify dev transaction journal.");
  }

  return {
    hiddenFiles: Array.isArray(value.hiddenFiles)
      ? value.hiddenFiles.map(parseHiddenFile)
      : [],
    files: value.files.map(parseTrackedFile),
  };
}

function parseTrackedFile(value: unknown): TrackedFile {
  if (!isRecord(value) || typeof value.path !== "string" || !Array.isArray(value.replacements)) {
    throw new Error("Invalid bshopify dev transaction journal.");
  }

  return {
    path: value.path,
    replacements: value.replacements.map(parseReverseReplacement),
  };
}

function parseHiddenFile(value: unknown): HiddenFile {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.hiddenPath !== "string") {
    throw new Error("Invalid bshopify dev transaction journal.");
  }

  return {
    hiddenPath: value.hiddenPath,
    path: value.path,
  };
}

function parseReverseReplacement(value: unknown): ReverseReplacement {
  if (
    !isRecord(value) ||
    typeof value.pattern !== "string" ||
    typeof value.value !== "string" ||
    (value.marker !== undefined && typeof value.marker !== "string")
  ) {
    throw new Error("Invalid bshopify dev transaction journal.");
  }

  return {
    marker: value.marker,
    pattern: value.pattern,
    value: value.value,
  };
}
