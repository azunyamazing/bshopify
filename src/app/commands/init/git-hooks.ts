import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { isNodeError } from "#/utils/node";
import {
  legacyPreCommitGuardCommand,
  legacyPreCommitGuardEndMarker,
  legacyPreCommitGuardStartMarker,
  preCommitGuardCommand,
  preCommitGuardEndMarker,
  preCommitGuardStartMarker,
  preCommitHookTemplate,
} from "./constants";
import { resolveProjectPath, toDisplayPath } from "./paths";
import type { InitResult } from "./types";

const execFileAsync = promisify(execFile);

interface GitHookPath {
  absolutePath: string;
  displayPath: string;
}

export async function writePreCommitHook(
  cwd: string,
  result: InitResult,
  previousHookPath?: string,
): Promise<string | undefined> {
  const hookPath = await resolveGitHookPath(cwd);

  if (hookPath === undefined) {
    result.warnings.push("git repository not found; pre-commit hook skipped");
    return undefined;
  }

  const created = await ensurePreCommitGuard(
    hookPath.absolutePath,
    hookPath.displayPath,
    result,
  );

  if (created) {
    await chmod(hookPath.absolutePath, 0o755);
  }

  await cleanupPreviousPreCommitGuard(cwd, result, previousHookPath, hookPath);

  return hookPath.displayPath;
}

async function ensurePreCommitGuard(
  absolutePath: string,
  displayPath: string,
  result: InitResult,
): Promise<boolean> {
  let current = "";

  try {
    current = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, preCommitHookTemplate);
    result.created.push(displayPath);
    return true;
  }

  if (current.includes(preCommitGuardStartMarker)) {
    const next = replacePreCommitGuardBlock(current);
    if (next === current) {
      result.skipped.push(displayPath);
      return false;
    }

    await writeFile(absolutePath, next);
    result.updated.push(displayPath);
    return true;
  }

  if (current.includes(preCommitGuardEndMarker)) {
    result.warnings.push(`${displayPath} has an incomplete bshopify app guard block`);
    return false;
  }

  const next = insertPreCommitGuardBlock(current);
  await writeFile(absolutePath, next);
  result.updated.push(displayPath);
  return true;
}

function insertPreCommitGuardBlock(current: string): string {
  const guardBlock = `${preCommitGuardStartMarker}\n${preCommitGuardCommand}\n${preCommitGuardEndMarker}`;
  const lines = removeLegacyPreCommitGuardBlock(current.split("\n")).filter(
    (line) => line.trim() !== legacyPreCommitGuardCommand,
  );
  const insertIndex = lines[0]?.startsWith("#!") ? 1 : 0;
  lines.splice(insertIndex, 0, guardBlock);

  return `${lines.join("\n")}${current.endsWith("\n") ? "" : "\n"}`;
}

function replacePreCommitGuardBlock(current: string): string {
  const guardBlock = `${preCommitGuardStartMarker}\n${preCommitGuardCommand}\n${preCommitGuardEndMarker}`;
  const blockPattern = new RegExp(
    `${escapeRegExp(preCommitGuardStartMarker)}\\n[\\s\\S]*?${escapeRegExp(preCommitGuardEndMarker)}`,
  );

  return current.replace(blockPattern, guardBlock);
}

async function cleanupPreviousPreCommitGuard(
  cwd: string,
  result: InitResult,
  previousHookPath: string | undefined,
  currentHookPath: GitHookPath,
): Promise<void> {
  if (previousHookPath === undefined) {
    return;
  }

  const previousAbsolutePath = resolveProjectPath(cwd, previousHookPath);
  if (previousAbsolutePath === currentHookPath.absolutePath) {
    return;
  }

  let current = "";
  try {
    current = await readFile(previousAbsolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  const next = removePreCommitGuardBlock(current);
  if (next === current) {
    return;
  }

  await writeFile(previousAbsolutePath, next);
  result.updated.push(`removed stale pre-commit guard ${toDisplayPath(cwd, previousAbsolutePath)}`);
}

function removePreCommitGuardBlock(current: string): string {
  const blockPattern = new RegExp(
    `\\n?${escapeRegExp(preCommitGuardStartMarker)}\\n[\\s\\S]*?${escapeRegExp(preCommitGuardEndMarker)}\\n?`,
  );

  return current.replace(blockPattern, "\n").replace(/\n{3,}/g, "\n\n");
}

function removeLegacyPreCommitGuardBlock(lines: string[]): string[] {
  const next: string[] = [];
  let isInsideLegacyGuardBlock = false;

  for (const line of lines) {
    if (line === legacyPreCommitGuardStartMarker) {
      isInsideLegacyGuardBlock = true;
      continue;
    }

    if (line === legacyPreCommitGuardEndMarker) {
      isInsideLegacyGuardBlock = false;
      continue;
    }

    if (!isInsideLegacyGuardBlock) {
      next.push(line);
    }
  }

  return next;
}

async function resolveGitHookPath(cwd: string): Promise<GitHookPath | undefined> {
  const gitPath = await readGitPath(cwd, "hooks/pre-commit");

  if (gitPath === undefined) {
    return undefined;
  }

  const absolutePath = resolveProjectPath(cwd, gitPath);
  await mkdir(dirname(absolutePath), { recursive: true });

  return {
    absolutePath,
    displayPath: toDisplayPath(cwd, absolutePath),
  };
}

async function readGitPath(cwd: string, path: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      cwd,
      "rev-parse",
      "--git-path",
      path,
    ]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
