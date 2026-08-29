import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configFileName } from "./constants";
import { hasTopLevelConfigProperty, replaceTopLevelConfigProperty } from "./source-edit";
import type { InitResult } from "./types";

export async function mergeRunnerConfig(
  cwd: string,
  result: InitResult,
  configFiles: Record<string, string>,
  replaceConfigFiles = false,
): Promise<void> {
  const configPath = join(cwd, configFileName);
  const current = await readFile(configPath, "utf8");
  const next = reconcileRunnerConfigSource(current, configFiles, replaceConfigFiles);

  if (next === undefined) {
    result.warnings.push(`${configFileName} could not be merged automatically`);
    return;
  }

  if (next === current) {
    return;
  }

  await writeFile(configPath, next);
  result.updated.push(configFileName);
}

function reconcileRunnerConfigSource(
  source: string,
  configFiles: Record<string, string>,
  replaceConfigFiles: boolean,
): string | undefined {
  const match = source.match(/export\s+default\s*\{([\s\S]*)\}\s*;?\s*$/);

  if (match === null || match.index === undefined) {
    return undefined;
  }

  const bodyStart = match.index + match[0].indexOf("{") + 1;
  const bodyEnd = source.lastIndexOf("}");
  if (bodyEnd < bodyStart) {
    return undefined;
  }

  const prefix = source.slice(0, bodyStart);
  const body = source.slice(bodyStart, bodyEnd);
  const suffix = source.slice(bodyEnd);
  const nextBody = mergeRunnerConfigBody(body, configFiles, replaceConfigFiles);

  return `${prefix}${nextBody}${suffix.endsWith("\n") ? suffix : `${suffix}\n`}`;
}

function mergeRunnerConfigBody(
  body: string,
  configFiles: Record<string, string>,
  replaceConfigFiles: boolean,
): string {
  const cleaned = body.replace(/\s+$/, "");
  const additions = [
    ["configFiles", renderConfigFilesBlock(configFiles)],
    ["failOnUnresolvedPlaceholders", "  failOnUnresolvedPlaceholders: true,"],
  ] as const;
  const nextParts: string[] = [cleaned];

  for (const [propertyName, propertySource] of additions) {
    if (hasTopLevelConfigProperty(cleaned, propertyName)) {
      if (propertyName === "configFiles" && replaceConfigFiles) {
        nextParts[0] = replaceTopLevelConfigProperty(
          nextParts[0] ?? cleaned,
          propertyName,
          propertySource,
        );
      }
      continue;
    }

    nextParts.push(propertySource);
  }

  const nextBody = nextParts
    .filter((part) => part.trim().length > 0)
    .join("\n\n");

  return `\n${nextBody}\n`;
}

function renderConfigFilesBlock(configFiles: Record<string, string>): string {
  const entries = Object.entries(configFiles)
    .filter(([, file]) => file.trim().length > 0)
    .map(([env, file]) => `    ${env}: "${file}",`)
    .join("\n");

  return `  configFiles: {\n${entries}\n  },`;
}
