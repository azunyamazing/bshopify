import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitattributesCliComment } from "#/app/commands/init/constants";
import { gitignoreCliComment } from "#/app/commands/init/gitignore";
import { bshopifyStateDir } from "#/app/runner/constants";
import { isNodeError } from "#/utils/node";
import type { ClearResult } from "./types";

/**
 * Reverts the `.gitignore` block appended by `init` (`# bshopify cli` plus
 * the state directory), restoring the file content the project had before
 * bshopify was added. The file is deleted when the block was all it held.
 */
export async function revertGitignoreBlock(
  cwd: string,
  result: ClearResult,
  stateDirName = bshopifyStateDir,
): Promise<void> {
  const gitignorePath = join(cwd, ".gitignore");
  let current = "";

  try {
    current = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }

    return;
  }

  const gitignoreManagedLines = new Set([gitignoreCliComment, `${stateDirName}/`]);
  const next = removeManagedLines(current, (line) => !gitignoreManagedLines.has(line));
  if (next === undefined) {
    return;
  }

  await writeOrRemoveFile(result, ".gitignore", gitignorePath, next);
}

/**
 * Reverts the `.gitattributes` entry appended by `init` (`# bshopify cli`
 * plus the `filter=bshopify` line), restoring the file content the project
 * had before bshopify was added. The file is deleted when the entry was all
 * it held.
 */
export async function revertGitattributesBlock(
  cwd: string,
  result: ClearResult,
): Promise<void> {
  const gitattributesPath = join(cwd, ".gitattributes");
  let current = "";

  try {
    current = await readFile(gitattributesPath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }

    return;
  }

  const next = removeManagedLines(
    current,
    (line) => line !== gitattributesCliComment && !line.includes("filter=bshopify"),
  );
  if (next === undefined) {
    return;
  }

  await writeOrRemoveFile(result, ".gitattributes", gitattributesPath, next);
}

function removeManagedLines(
  content: string,
  keepLine: (line: string) => boolean,
): string | undefined {
  const lines = content.split(/\r?\n/);
  const kept = lines.filter((line) => keepLine(line));

  if (kept.length === lines.length) {
    return undefined;
  }

  const joined = kept.join("\n");
  return joined.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
}

async function writeOrRemoveFile(
  result: ClearResult,
  displayPath: string,
  targetPath: string,
  next: string,
): Promise<void> {
  if (next.trim().length === 0) {
    await rm(targetPath, { force: true });
    result.removed.push(displayPath);
    return;
  }

  await writeFile(targetPath, next.endsWith("\n") ? next : `${next}\n`);
  result.updated.push(displayPath);
}
