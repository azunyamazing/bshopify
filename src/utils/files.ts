import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isNodeError } from "./node";

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
