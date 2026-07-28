import { readFile, writeFile } from "node:fs/promises";
import type { FileTransaction, TrackedFile } from "./types";

export async function createFileTransaction(): Promise<FileTransaction> {
  const tracked = new Map<string, TrackedFile>();

  return {
    async restore() {
      const files = [...tracked.values()].reverse();

      for (const file of files) {
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
    },
    async writeFile(path, content, replacement) {
      const trackedFile = tracked.get(path) ?? { path, replacements: [] };
      trackedFile.replacements.push(replacement);
      tracked.set(path, trackedFile);
      await writeFile(path, content);
    },
  };
}
