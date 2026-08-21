import { constants } from "node:fs";
import { access, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isNodeError } from "./node";
import { formatPath, resolvePath } from "./paths";

/**
 * Minimal change-reporting surface for file writers; domain result objects
 * (e.g. the init `InitResult`) satisfy this structurally.
 */
export interface FileWriteChanges {
  created: string[];
  skipped: string[];
}

export async function findFilesByExtension(
  root: string,
  extension: string,
): Promise<string[]> {
  try {
    await stat(root);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        files.push(...(await findFilesByExtension(path, extension)));
      }

      continue;
    }

    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(path);
    }
  }

  return files;
}

export async function writeFileIfMissing(
  cwd: string,
  path: string,
  content: string,
  changes: FileWriteChanges,
): Promise<boolean> {
  const absolutePath = resolvePath(cwd, path);
  const displayPath = formatPath(cwd, absolutePath);

  try {
    await access(absolutePath, constants.F_OK);
    changes.skipped.push(displayPath);
    return false;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  changes.created.push(displayPath);
  return true;
}
