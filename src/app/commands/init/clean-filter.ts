import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { isNodeError } from "#/utils/node";
import {
  cleanFilterCommand,
  cleanFilterGeneratedHeader,
  cleanFilterScript,
  cleanFilterScriptName,
  cleanFilterSmudgeCommand,
  gitattributesCliComment,
} from "./constants";
import type { InitResult } from "./types";

const execFileAsync = promisify(execFile);

export async function writeCleanFilterScript(
  cwd: string,
  result: InitResult,
): Promise<string> {
  // Git runs clean/smudge filters from the top level of the working tree, so
  // the script must live under the repo top's `.bshopify/` even when init
  // runs in a monorepo subdirectory. Without a git repo, keep it under cwd.
  const topLevel = await resolveGitTopLevel(cwd);
  const scriptDir = topLevel ?? cwd;
  const targetPath = join(scriptDir, cleanFilterScriptName);
  const displayPath = cleanFilterScriptName;
  const current = await readCleanFilterScript(targetPath);

  if (current === "") {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, cleanFilterScript);
    result.created.push(displayPath);
    return displayPath;
  }

  if (current === cleanFilterScript || !isGeneratedCleanFilterScript(current)) {
    // Keep the current script: it is either the latest template or user
    // content (no bshopify generated header). Only recognizable bshopify
    // scripts from older versions are refreshed below.
    result.skipped.push(displayPath);
    return displayPath;
  }

  // The script must stay in sync with the marker format produced by
  // restore-markers.ts, so an outdated bshopify-generated script is replaced
  // with the latest template whenever init runs again.
  await writeFile(targetPath, cleanFilterScript);
  result.updated.push(displayPath);
  return displayPath;
}

function isGeneratedCleanFilterScript(content: string): boolean {
  return content.includes(cleanFilterGeneratedHeader);
}

async function readCleanFilterScript(targetPath: string): Promise<string> {
  try {
    return await readFile(targetPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

export function formatGitattributesFilterLine(extensionsRoot: string): string {
  return `${extensionsRoot}/** filter=bshopify`;
}

export async function ensureGitattributesEntry(
  cwd: string,
  result: InitResult,
  extensionsRoot: string,
): Promise<void> {
  const gitattributesPath = join(cwd, ".gitattributes");
  const filterLine = formatGitattributesFilterLine(extensionsRoot);
  const nextBlock = `${gitattributesCliComment}\n${filterLine}\n`;
  let current = "";

  try {
    current = await readFile(gitattributesPath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  if (hasGitattributesFilterLine(current, filterLine)) {
    result.skipped.push(".gitattributes");
    return;
  }

  // Drop the cli comment and any stale bshopify filter line (e.g. from a
  // previous extensionsRoot) before appending the current block.
  const filtered = current
    .split(/\r?\n/)
    .filter((line) => line !== gitattributesCliComment && !line.includes("filter=bshopify"))
    .join("\n")
    .replace(/\n+$/, "");
  const separator = filtered.length > 0 ? "\n\n" : "";

  await writeFile(gitattributesPath, `${filtered}${separator}${nextBlock}`);
  result.updated.push(".gitattributes");
}

function hasGitattributesFilterLine(current: string, filterLine: string): boolean {
  return current.split(/\r?\n/).includes(filterLine);
}

export async function configureGitFilters(cwd: string, result: InitResult): Promise<boolean> {
  if (!(await isGitRepository(cwd))) {
    result.warnings.push("git repository not found; git clean filter skipped");
    return false;
  }

  const entries: Array<[string, string]> = [
    ["filter.bshopify.clean", cleanFilterCommand],
    ["filter.bshopify.smudge", cleanFilterSmudgeCommand],
    ["filter.bshopify.required", "false"],
  ];
  let changed = false;

  for (const [name, value] of entries) {
    if ((await readGitConfig(cwd, name)) === value) {
      continue;
    }

    await execFileAsync("git", ["-C", cwd, "config", name, value]);
    changed = true;
  }

  if (changed) {
    result.updated.push("git config filter.bshopify");
  } else {
    result.skipped.push("git config filter.bshopify");
  }

  return changed;
}

export async function checkCleanFilter(
  cwd: string,
  result: InitResult,
  extensionsRoot: string,
): Promise<void> {
  if (!(await isGitRepository(cwd))) {
    return;
  }

  const topLevel = await resolveGitTopLevel(cwd);
  const scriptExists = await pathExists(join(topLevel ?? cwd, cleanFilterScriptName));
  const filterConfigured = (await readGitConfig(cwd, "filter.bshopify.clean")) === cleanFilterCommand;
  const filterLine = formatGitattributesFilterLine(extensionsRoot);
  const gitattributesHasLine = await hasGitattributesFilterLineInFile(cwd, filterLine);
  const ok = scriptExists && filterConfigured && gitattributesHasLine;

  result.checks.push({
    name: "git clean filter",
    ok,
    message: ok
      ? "bshopify clean filter configured"
      : "bshopify clean filter not configured; run bshopify app init",
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function hasGitattributesFilterLineInFile(
  cwd: string,
  filterLine: string,
): Promise<boolean> {
  let current = "";

  try {
    current = await readFile(join(cwd, ".gitattributes"), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }

  return hasGitattributesFilterLine(current, filterLine);
}

async function resolveGitTopLevel(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", cwd, "rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
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
