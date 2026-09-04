import { runProjectChecks } from "./checks";
import { ensureShopifyConfigFiles } from "./config-files";
import { bshopifyStateDir } from "#/app/runner/constants";
import { loadRunnerConfig } from "#/app/runner/config";
import {
  checkCleanFilter,
  configureGitFilters,
  ensureGitattributesEntry,
  writeCleanFilterScript,
} from "./clean-filter";
import { writeRunnerConfig } from "./files";
import { writeManagedEntries } from "#/extension/manage";
import { ensureGitignoreEntry } from "./gitignore";
import { writePreCommitHook } from "./git-hooks";
import {
  applyRunnerConfigToManifest,
  loadInitManifest,
  recordCleanFilter,
  recordPreCommitHook,
  saveInitManifest,
} from "./manifest";
import type { InitOptions, InitResult } from "./types";
import type { RunnerConfig } from "#/app/runner/types";
import { ansi, colorize, formatSection } from "#/utils/output";
import { formatChecks } from "./utils";

export async function initProject(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const result = createEmptyResult();
  let config: RunnerConfig;
  try {
    config = await loadRunnerConfig(cwd);
  } catch (error) {
    if (!options.check) {
      throw error;
    }

    result.checks.push({
      name: "bshopify.config.mjs",
      ok: false,
      message: "invalid bshopify.config.mjs",
    });
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }
  const manifest = await loadInitManifest(cwd);

  let configFiles = config.configFiles;
  if (options.check !== true) {
    configFiles = await ensureShopifyConfigFiles({
      configFiles: config.configFiles,
      cwd,
      result,
      runShopifyCommand: options.runShopifyCommand,
    });
  }

  await runProjectChecks(cwd, result, {
    configFiles: [...new Set(Object.values(configFiles))],
    extensionsRoot: config.extensionsRoot,
  });
  await checkCleanFilter(cwd, result, config.extensionsRoot);

  if (options.check || result.errors.length > 0) {
    return result;
  }

  await writeRunnerConfig(cwd, result, configFiles, config.configFiles);
  await ensureGitignoreEntry(cwd, result, bshopifyStateDir);
  const cleanFilterPath = await writeCleanFilterScript(cwd, result);
  recordCleanFilter(manifest, cleanFilterPath);
  await ensureGitattributesEntry(cwd, result, config.extensionsRoot);
  await configureGitFilters(cwd, result);

  const preCommitHookPath = await writePreCommitHook(cwd, result);
  recordPreCommitHook(manifest, preCommitHookPath);
  await writeManagedEntries(
    cwd,
    result,
    {
      entryFileName: config.entryFileName,
      extensionsRoot: config.extensionsRoot,
    },
    manifest,
  );
  applyRunnerConfigToManifest(manifest);
  await saveInitManifest(cwd, manifest);

  return result;
}

export function formatInitResult(result: InitResult): string {
  const lines = [
    "",
    ...formatChecks(result.checks),
    ...formatSection("created", result.created),
    ...formatSection("updated", result.updated),
    ...formatSection("warnings", result.warnings),
    ...formatSection("skipped", result.skipped),
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
