import { writeFileIfMissing } from "#/utils/files";
import { configFileName, renderRunnerConfigTemplate } from "./constants";
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
