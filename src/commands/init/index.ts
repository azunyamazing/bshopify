import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import {
  configFileName,
  entryFileName,
  extensionEntryTemplate,
  legacyPreCommitGuardCommand,
  preCommitGuardCommand,
  preCommitGuardEndMarker,
  preCommitGuardStartMarker,
  preCommitHookTemplate,
  recommendedScripts,
  requiredShopifyConfigFiles,
  runnerConfigTemplate,
  tmpRoot,
} from "./constants.js";
import {
  formatChecks,
  formatSection,
  colorize,
  isNodeError,
  toPosixPath,
} from "./utils.js";

export interface InitOptions {
  check?: boolean;
  cwd?: string;
}

export interface InitCheck {
  message: string;
  name: string;
  ok: boolean;
}

export interface InitResult {
  checks: InitCheck[];
  created: string[];
  errors: string[];
  skipped: string[];
  updated: string[];
  warnings: string[];
}

interface ProjectPackageJson {
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

const execFileAsync = promisify(execFile);

export async function initProject(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const result = createEmptyResult();
  await runProjectChecks(cwd, result);

  if (options.check || result.errors.length > 0) {
    return result;
  }

  await writeRunnerConfig(cwd, result);
  await ensureGitignoreEntry(cwd, result);
  await writePreCommitHook(cwd, result);
  await writeExtensionEntries(cwd, result);
  await updatePackageScripts(cwd, result);

  return result;
}

function createEmptyResult(): InitResult {
  return {
    checks: [],
    created: [],
    errors: [],
    skipped: [],
    updated: [],
    warnings: [],
  };
}

async function runProjectChecks(cwd: string, result: InitResult): Promise<void> {
  await checkPath(cwd, "package.json", "found package.json", result);
  await checkPath(cwd, "extensions", "found extensions directory", result);

  for (const fileName of requiredShopifyConfigFiles) {
    await checkPath(cwd, fileName, `found ${fileName}`, result);
  }

  const extensionNames = await readExtensionNames(cwd);
  if (extensionNames.length === 0) {
    result.checks.push({
      name: "extensions/*",
      ok: false,
      message: "no extension directories found",
    });
    result.errors.push("no extension directories found under extensions/");
  }
}

async function checkPath(
  cwd: string,
  name: string,
  successMessage: string,
  result: InitResult,
): Promise<void> {
  try {
    await access(join(cwd, name), constants.F_OK);
    result.checks.push({ name, ok: true, message: successMessage });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }

    result.checks.push({ name, ok: false, message: `missing ${name}` });
    result.errors.push(`missing ${name}`);
  }
}

async function writeRunnerConfig(cwd: string, result: InitResult): Promise<void> {
  await writeFileIfMissing(cwd, configFileName, runnerConfigTemplate, result);
}

async function ensureGitignoreEntry(cwd: string, result: InitResult): Promise<void> {
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

async function writePreCommitHook(cwd: string, result: InitResult): Promise<void> {
  const hookPath = await resolveGitHookPath(cwd);

  if (hookPath === undefined) {
    result.warnings.push("git repository not found; pre-commit hook skipped");
    return;
  }

  const created = await ensurePreCommitGuard(
    hookPath.absolutePath,
    hookPath.displayPath,
    result,
  );

  if (created) {
    await chmod(hookPath.absolutePath, 0o755);
  }
}

async function writeExtensionEntries(cwd: string, result: InitResult): Promise<void> {
  const extensionNames = await readExtensionNames(cwd);

  for (const extensionName of extensionNames) {
    const entryPath = join("extensions", extensionName, entryFileName);
    await writeFileIfMissing(cwd, entryPath, extensionEntryTemplate, result);
  }
}

async function updatePackageScripts(cwd: string, result: InitResult): Promise<void> {
  const packagePath = join(cwd, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as ProjectPackageJson;
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

  if (
    current.includes(preCommitGuardStartMarker)
  ) {
    result.skipped.push(displayPath);
    return false;
  }

  const next = insertPreCommitGuardBlock(current);
  await writeFile(absolutePath, next);
  result.updated.push(displayPath);
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

function insertPreCommitGuardBlock(current: string): string {
  const guardBlock = `${preCommitGuardStartMarker}\n${preCommitGuardCommand}\n${preCommitGuardEndMarker}`;
  const lines = current
    .split("\n")
    .filter((line) => line.trim() !== legacyPreCommitGuardCommand);
  const insertIndex = lines[0]?.startsWith("#!") ? 1 : 0;
  lines.splice(insertIndex, 0, guardBlock);

  return `${lines.join("\n")}${current.endsWith("\n") ? "" : "\n"}`;
}

async function readExtensionNames(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, "extensions"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function resolveGitHookPath(
  cwd: string,
): Promise<{ absolutePath: string; displayPath: string } | undefined> {
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

function toDisplayPath(cwd: string, absolutePath: string): string {
  const relativePath = relative(cwd, absolutePath);

  if (relativePath.length > 0 && !relativePath.startsWith("..")) {
    return toPosixPath(relativePath);
  }

  return toPosixPath(absolutePath);
}

function resolveProjectPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
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

export function formatInitResult(result: InitResult): string {
  const lines = [
    ...formatChecks(result.checks),
    ...formatSection("created", result.created),
    ...formatSection("updated", result.updated),
    ...formatSection("skipped", result.skipped),
    ...formatSection("warnings", result.warnings),
    ...formatSection("errors", result.errors),
    "\n"
  ];

  return lines.join("\n");
}
