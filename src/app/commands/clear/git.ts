import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  cleanFilterCommand,
  cleanFilterSmudgeCommand,
  legacyPreCommitGuardCommand,
  legacyPreCommitGuardEndMarker,
  legacyPreCommitGuardStartMarker,
  preCommitGuardEndMarker,
  preCommitGuardStartMarker,
  preCommitHookTemplate,
} from "#/app/commands/init/constants";
import { isNodeError } from "#/utils/node";
import { formatPath, resolvePath } from "#/utils/paths";
import type { ClearResult } from "./types";

const execFileAsync = promisify(execFile);

const gitFilterEntries: Array<[string, string]> = [
  ["filter.bshopify.clean", cleanFilterCommand],
  ["filter.bshopify.smudge", cleanFilterSmudgeCommand],
  ["filter.bshopify.required", "false"],
];

const guardMarkerLines = new Set([
  preCommitGuardStartMarker,
  preCommitGuardEndMarker,
  legacyPreCommitGuardStartMarker,
  legacyPreCommitGuardEndMarker,
  legacyPreCommitGuardCommand,
]);

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", cwd, "rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

export async function resolveGitTopLevel(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Removes the bshopify pre-commit guard from the hook Git actually runs and,
 * when the manifest records a stale hook location, from that file as well.
 * A hook file that is byte-identical to the bshopify template is deleted
 * entirely; a hook with user content keeps that content without the guard.
 */
export async function removePreCommitGuard(
  cwd: string,
  result: ClearResult,
  manifestPath: string | undefined,
): Promise<void> {
  if (!(await isGitRepository(cwd))) {
    result.warnings.push("git repository not found; pre-commit hook skipped");
    await removeGuardFromManifestPath(cwd, result, manifestPath);
    return;
  }

  const hookPath = await resolveGitHookPath(cwd);
  if (hookPath !== undefined) {
    await removeGuardFromHookFile(cwd, result, hookPath.absolutePath, hookPath.displayPath);
  }

  if (manifestPath !== undefined && manifestPath !== hookPath?.displayPath) {
    await removeGuardFromManifestPath(cwd, result, manifestPath);
  }
}

/**
 * Removes the local `filter.bshopify.*` git config entries written by `init`.
 * Only values still matching the bshopify-managed commands are unset; custom
 * values under the same key are left in place with a warning.
 */
export async function unsetGitFilters(cwd: string, result: ClearResult): Promise<void> {
  if (!(await isGitRepository(cwd))) {
    result.warnings.push("git repository not found; git clean filter config skipped");
    return;
  }

  let changed = false;

  for (const [name, managedValue] of gitFilterEntries) {
    const current = await readGitConfig(cwd, name);
    if (current === undefined) {
      continue;
    }

    if (current !== managedValue) {
      result.warnings.push(`git config ${name} has a custom value; left in place`);
      continue;
    }

    await execFileAsync("git", ["-C", cwd, "config", "--unset", name]);
    changed = true;
  }

  if (changed) {
    result.updated.push("git config filter.bshopify");
  }
}

async function removeGuardFromManifestPath(
  cwd: string,
  result: ClearResult,
  manifestPath: string | undefined,
): Promise<void> {
  if (manifestPath === undefined) {
    return;
  }

  const absolutePath = resolvePath(cwd, manifestPath);
  await removeGuardFromHookFile(cwd, result, absolutePath, formatPath(cwd, absolutePath));
}

async function removeGuardFromHookFile(
  cwd: string,
  result: ClearResult,
  absolutePath: string,
  displayPath: string,
): Promise<void> {
  let current = "";

  try {
    current = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }

    return;
  }

  if (current === preCommitHookTemplate) {
    await rm(absolutePath, { force: true });
    result.removed.push(displayPath);
    return;
  }

  if (!hasGuardContent(current)) {
    return;
  }

  if (current.includes(preCommitGuardStartMarker) && !current.includes(preCommitGuardEndMarker)) {
    result.warnings.push(`incomplete bshopify app guard block in ${displayPath}; left in place`);
    return;
  }

  const next = stripGuardBlocks(current);
  if (next.trim().length === 0) {
    await rm(absolutePath, { force: true });
    result.removed.push(displayPath);
    return;
  }

  await writeFile(absolutePath, next.endsWith("\n") ? next : `${next}\n`);
  result.updated.push(displayPath);
}

function hasGuardContent(content: string): boolean {
  return content
    .split(/\r?\n/)
    .some((line) => guardMarkerLines.has(line.trim()));
}

function stripGuardBlocks(content: string): string {
  let next = content;
  next = replaceGuardBlock(next, preCommitGuardStartMarker, preCommitGuardEndMarker);
  next = replaceGuardBlock(next, legacyPreCommitGuardStartMarker, legacyPreCommitGuardEndMarker);
  next = next
    .split(/\r?\n/)
    .filter((line) => !guardMarkerLines.has(line.trim()))
    .join("\n");

  return next.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
}

function replaceGuardBlock(content: string, startMarker: string, endMarker: string): string {
  const blockPattern = new RegExp(
    `\\n?${escapeRegExp(startMarker)}\\n[\\s\\S]*?${escapeRegExp(endMarker)}\\n?`,
  );
  return content.replace(blockPattern, "\n");
}

async function resolveGitHookPath(
  cwd: string,
): Promise<{ absolutePath: string; displayPath: string } | undefined> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      cwd,
      "rev-parse",
      "--git-path",
      "hooks/pre-commit",
    ]);
    const gitPath = stdout.trim();
    const absolutePath = resolvePath(cwd, gitPath);

    return {
      absolutePath,
      displayPath: formatPath(cwd, absolutePath),
    };
  } catch {
    return undefined;
  }
}

async function readGitConfig(cwd: string, name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "config", "--get", name]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
