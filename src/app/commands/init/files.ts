import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileIfMissing } from "#/utils/files";
import { readPackageJson } from "#/utils/package-json";
import {
  configFileName,
  recommendedScripts,
  renderRunnerConfigTemplate,
} from "./constants";
import { mergeRunnerConfig } from "./runner-config-merge";
import type { InitResult } from "./types";

export async function writeRunnerConfig(
  cwd: string,
  result: InitResult,
  configFiles: Record<string, string>,
  previousConfigFiles: Record<string, string> = configFiles,
): Promise<void> {
  const created = await writeFileIfMissing(
    cwd,
    configFileName,
    renderRunnerConfigTemplate(configFiles),
    result,
  );

  if (!created) {
    const replaceConfigFiles = !sameConfigFiles(configFiles, previousConfigFiles);
    await mergeRunnerConfig(cwd, result, configFiles, replaceConfigFiles);
  }
}

function sameConfigFiles(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left).filter(([, file]) => file.trim().length > 0);
  const rightEntries = Object.entries(right).filter(([, file]) => file.trim().length > 0);

  return (
    leftEntries.length === rightEntries.length
    && leftEntries.every(
      ([env, file]) => right[env] === file,
    )
  );
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
