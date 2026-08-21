import { runProjectChecks } from "./checks";
import { bshopifyStateDir } from "#/app/runner/constants";
import { loadRunnerConfig } from "#/app/runner/config";
import {
  checkCleanFilter,
  configureGitFilters,
  ensureGitattributesEntry,
  writeCleanFilterScript,
} from "./clean-filter";
import {
  updatePackageScripts,
  writeRunnerConfig,
} from "./files";
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
  result.mode = getInitMode(options);
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
  await runProjectChecks(cwd, result, {
    configFiles: Object.values(config.configFiles),
    extensionsRoot: config.extensionsRoot,
  });
  await checkCleanFilter(cwd, result, config.extensionsRoot);

  if (options.check || result.errors.length > 0) {
    return result;
  }

  await writeRunnerConfig(cwd, result);
  await ensureGitignoreEntry(cwd, result, bshopifyStateDir);
  const cleanFilterPath = await writeCleanFilterScript(cwd, result, options.update === true);
  recordCleanFilter(manifest, cleanFilterPath);
  await ensureGitattributesEntry(cwd, result, config.extensionsRoot);
  const cleanFilterChanged = await configureGitFilters(cwd, result);

  if (cleanFilterChanged) {
    result.warnings.push(
      'run "git add --renormalize ." to apply the clean filter to already-tracked files',
    );
  }

  const previousPreCommitHookPath = options.update === true
    ? manifest.preCommitHook?.path
    : undefined;
  const preCommitHookPath = await writePreCommitHook(cwd, result, previousPreCommitHookPath);
  recordPreCommitHook(manifest, preCommitHookPath);
  await writeManagedEntries(
    cwd,
    result,
    {
      entryFileName: config.entryFileName,
      extensionsRoot: config.extensionsRoot,
    },
    options.update === true,
    manifest,
  );
  await updatePackageScripts(cwd, result, options.update === true);
  applyRunnerConfigToManifest(manifest);
  await saveInitManifest(cwd, manifest);

  return result;
}

export function formatInitResult(result: InitResult): string {
  const lines = [
    "",
    ...formatChecks(result.checks),
    ...formatLocalChanges(result),
    ...formatStandardChangeSections(result),
    ...formatSection("skipped", result.skipped),
    ...formatSection("errors", result.errors),
    "\n",
  ];

  const command = result.mode === "update" ? "bshopify app init --update" : "bshopify app init";
  return colorize(command, ansi.bold) + lines.join("\n");
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

function getInitMode(options: InitOptions): "check" | "init" | "update" {
  if (options.check === true) {
    return "check";
  }

  return options.update === true ? "update" : "init";
}

function formatLocalChanges(result: InitResult): string[] {
  if (result.mode !== "update") {
    return [];
  }

  const items = [
    ...result.created.map((item) => `  ${colorize("+", ansi.green)} created ${item}`),
    ...result.updated.map((item) => `  ${colorize("~", ansi.cyan)} updated ${item}`),
    ...result.warnings.map((item) => `  ${colorize("!", ansi.yellow)} warning ${item}`),
  ];

  return [
    "",
    colorize(colorize("Local changes", ansi.cyan), ansi.bold),
    "",
    ...(items.length > 0 ? items : [`  ${colorize("-", ansi.gray)} no local changes`]),
  ];
}

function formatStandardChangeSections(result: InitResult): string[] {
  if (result.mode === "update") {
    return [];
  }

  return [
    ...formatSection("created", result.created),
    ...formatSection("updated", result.updated),
    ...formatSection("warnings", result.warnings),
  ];
}
