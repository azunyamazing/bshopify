import { runProjectChecks } from "./checks";
import {
  ensureGitignoreEntry,
  updatePackageScripts,
  writeExtensionEntries,
  writeRunnerConfig,
} from "./files";
import { writePreCommitHook } from "./git-hooks";
import type { InitOptions, InitResult } from "./types";
import { ansi, colorize, formatSection } from "#/utils/output";
import { formatChecks } from "./utils";

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

export function formatInitResult(result: InitResult): string {
  const lines = [
    "",
    ...formatChecks(result.checks),
    ...formatSection("created", result.created),
    ...formatSection("updated", result.updated),
    ...formatSection("skipped", result.skipped),
    ...formatSection("warnings", result.warnings),
    ...formatSection("errors", result.errors),
    "\n",
  ];

  return colorize("bshopify app init", ansi.bold) + lines.join("\n");
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
