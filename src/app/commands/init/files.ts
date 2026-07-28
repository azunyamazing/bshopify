import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isNodeError } from "#/utils/node";
import { readPackageJson } from "#/utils/package-json";
import { readExtensionNames } from "./checks";
import {
  configFileName,
  entryFileName,
  extensionEntryTemplate,
  recommendedScripts,
  runnerConfigTemplate,
  tmpRoot,
} from "./constants";
import { resolveProjectPath, toDisplayPath } from "./paths";
import type { InitResult } from "./types";

export async function writeRunnerConfig(
  cwd: string,
  result: InitResult,
): Promise<void> {
  await writeFileIfMissing(cwd, configFileName, runnerConfigTemplate, result);
}

export async function ensureGitignoreEntry(
  cwd: string,
  result: InitResult,
): Promise<void> {
  const gitignorePath = join(cwd, ".gitignore");
  let current = "";

  try {
    current = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const lines = current.split(/\r?\n/).filter(Boolean);
  if (lines.includes(tmpRoot)) {
    result.skipped.push(".gitignore");
    return;
  }

  const next = `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${tmpRoot}\n`;
  await writeFile(gitignorePath, next);
  result.updated.push(".gitignore");
}

export async function writeExtensionEntries(
  cwd: string,
  result: InitResult,
): Promise<void> {
  const extensionNames = await readExtensionNames(cwd);

  for (const extensionName of extensionNames) {
    const entryPath = join("extensions", extensionName, entryFileName);
    await writeFileIfMissing(cwd, entryPath, extensionEntryTemplate, result);
  }
}

export async function updatePackageScripts(
  cwd: string,
  result: InitResult,
): Promise<void> {
  const packagePath = join(cwd, "package.json");
  const packageJson = await readPackageJson(packagePath);
  const scripts = packageJson.scripts ?? {};
  const changes: string[] = [];

  for (const [name, command] of Object.entries(recommendedScripts)) {
    if (scripts[name] === command) {
      continue;
    }

    const previousCommand = scripts[name];
    changes.push(formatScriptChange(name, command, previousCommand));
    scripts[name] = command;
  }

  if (changes.length === 0) {
    result.skipped.push("package.json scripts");
    return;
  }

  packageJson.scripts = scripts;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  result.updated.push(...changes);
}

async function writeFileIfMissing(
  cwd: string,
  path: string,
  content: string,
  result: InitResult,
): Promise<boolean> {
  const absolutePath = resolveProjectPath(cwd, path);
  const displayPath = toDisplayPath(cwd, absolutePath);

  try {
    await access(absolutePath, constants.F_OK);
    result.skipped.push(displayPath);
    return false;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  result.created.push(displayPath);
  return true;
}

function formatScriptChange(
  name: string,
  command: string,
  previousCommand: string | undefined,
): string {
  if (previousCommand === undefined) {
    return `package.json scripts: added ${name}`;
  }

  return `package.json scripts: replaced ${name}: ${JSON.stringify(previousCommand)} -> ${JSON.stringify(command)}`;
}
