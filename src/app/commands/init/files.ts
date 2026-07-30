import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isNodeError } from "#/utils/node";
import { readPackageJson } from "#/utils/package-json";
import {
  configFileName,
  recommendedScripts,
  runnerConfigTemplate,
} from "./constants";
import { resolveProjectPath, toDisplayPath } from "./paths";
import { mergeRunnerConfig } from "./runner-config-merge";
import type { InitResult } from "./types";

export async function writeRunnerConfig(
  cwd: string,
  result: InitResult,
): Promise<void> {
  const created = await writeFileIfMissing(cwd, configFileName, runnerConfigTemplate, result);

  if (!created) {
    await mergeRunnerConfig(cwd, result);
  }
}

export async function updatePackageScripts(
  cwd: string,
  result: InitResult,
  onlyAddMissing = false,
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
    if (onlyAddMissing && previousCommand !== undefined) {
      result.warnings.push(
        `package.json scripts: kept custom ${name}: ${JSON.stringify(previousCommand)}`,
      );
      continue;
    }

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

export async function writeFileIfMissing(
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
