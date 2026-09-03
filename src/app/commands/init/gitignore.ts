import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bshopifyStateDir } from "#/app/runner/constants";
import { isNodeError } from "#/utils/node";
import type { InitResult } from "./types";

export const gitignoreCliComment = "# bshopify cli";

export async function ensureGitignoreEntry(
  cwd: string,
  result: InitResult,
  stateDirName = bshopifyStateDir,
): Promise<void> {
  const gitignorePath = join(cwd, ".gitignore");
  const gitignoreStateDir = formatGitignoreStateDir(stateDirName);
  const nextBlock = formatGitignoreCliBlock(gitignoreStateDir);
  let current = "";

  try {
    current = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const next = updateGitignoreTmpBlock(
    current,
    gitignoreStateDir,
    nextBlock,
  );

  if (next === current) {
    result.skipped.push(".gitignore");
    return;
  }

  await writeFile(gitignorePath, next);
  result.updated.push(".gitignore");
}

function formatGitignoreStateDir(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function formatGitignoreCliBlock(gitignoreStateDir: string): string {
  return `${gitignoreCliComment}\n${gitignoreStateDir}\n`;
}

function updateGitignoreTmpBlock(
  current: string,
  gitignoreStateDir: string,
  nextBlock: string,
): string {
  if (hasGitignoreCliBlock(current, gitignoreStateDir)) {
    return current;
  }

  const existingLines = current.split(/\r?\n/);
  const managedStateLines = new Set([gitignoreCliComment, gitignoreStateDir]);
  const filtered = existingLines.filter(
    (line) => !managedStateLines.has(line),
  );
  const withoutLegacyTmpRoot = filtered.join("\n").replace(/\n+$/, "");
  const separator = withoutLegacyTmpRoot.length > 0 ? "\n\n" : "";

  return `${withoutLegacyTmpRoot}${separator}${nextBlock}`;
}

function hasGitignoreCliBlock(current: string, gitignoreStateDir: string): boolean {
  const lines = current.split(/\r?\n/);

  return lines.some((line, index) =>
    line === gitignoreCliComment && lines[index + 1] === gitignoreStateDir
  );
}
