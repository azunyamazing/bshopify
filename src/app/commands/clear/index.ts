import { confirm } from "@inquirer/prompts";
import { access, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { configFileName } from "#/app/commands/init/constants";
import { loadInitManifest } from "#/app/commands/init/manifest";
import { defaultRunnerConfig, loadRunnerConfig } from "#/app/runner/config";
import { isNodeError } from "#/utils/node";
import { ansi, colorize, formatSection } from "#/utils/output";
import type { RunnerConfig } from "#/app/runner/types";
import { revertGitattributesBlock, revertGitignoreBlock } from "./dotfiles";
import { removeManagedExtensionEntries } from "./entries";
import { removePreCommitGuard, unsetGitFilters } from "./git";
import {
  findLivePreparePid,
  removeStateDir,
  removeTopLevelCleanerScript,
  restorePendingTransaction,
} from "./state";
import type { ClearOptions, ClearResult } from "./types";

/**
 * Removes every file bshopify generated for the current app project and
 * reverts the git integration added by `init`, leaving the project as it was
 * before bshopify was added:
 *
 * - the project state directory `.bshopify/` (manifest, git clean filter
 *   script, locks and transaction journals),
 * - the runner config `bshopify.config.mjs`,
 * - generated (unmodified) extension entry files recorded in the manifest,
 * - the `.gitignore` / `.gitattributes` blocks, the pre-commit guard and the
 *   `filter.bshopify.*` git config entries written by `init`.
 *
 * Customized files (edited extension entries, user hook commands, custom git
 * config values) are never deleted and are reported as warnings. The command
 * refuses to run while an `app dev` / `app deploy` session is live (the
 * prepare lock holds a running pid); stale pending transactions from a
 * crashed session are restored before the state directory goes away.
 */
export async function clearProject(options: ClearOptions = {}): Promise<ClearResult> {
  const cwd = options.cwd ?? process.cwd();
  const result = createEmptyClearResult();
  const livePid = await findLivePreparePid(cwd);

  if (livePid !== undefined) {
    result.errors.push(
      `bshopify app dev/deploy is already running (pid ${livePid}); stop it before running bshopify app clear`,
    );
    return result;
  }

  const config = await loadClearConfig(cwd, result);
  const manifest = await loadInitManifest(cwd);

  if (options.yes !== true) {
    const shouldClear = await confirm({
      default: false,
      message: `Remove all bshopify-generated files from the app project in ${cwd}? This deletes bshopify.config.mjs, .bshopify/ and generated extension entries, and reverts the bshopify git hook, filters and ignore entries.`,
    });

    if (!shouldClear) {
      return result;
    }
  }

  await removeManagedExtensionEntries(cwd, result, config, manifest);
  await removeRunnerConfigFile(cwd, result);
  await revertGitignoreBlock(cwd, result);
  await revertGitattributesBlock(cwd, result);
  await removePreCommitGuard(cwd, result, manifest.preCommitHook?.path);
  await unsetGitFilters(cwd, result);
  await restorePendingTransaction(cwd, result);
  await removeStateDir(cwd, result);
  await removeTopLevelCleanerScript(cwd, result);

  return result;
}

export function formatClearResult(result: ClearResult): string {
  const hasChanges = result.removed.length > 0 || result.updated.length > 0;
  const showIdleNote =
    !hasChanges
    && result.warnings.length === 0
    && result.errors.length === 0;
  const lines = [
    "",
    ...(hasChanges
      ? formatSection("removed", result.removed)
      : showIdleNote
        ? [`  ${colorize("no bshopify-generated files found", ansi.gray)}`]
        : []),
    ...formatSection("updated", result.updated),
    ...formatSection("warnings", result.warnings),
    ...formatSection("errors", result.errors),
    "\n",
  ];

  return colorize("bshopify app clear", ansi.bold) + lines.join("\n");
}

async function loadClearConfig(cwd: string, result: ClearResult): Promise<RunnerConfig> {
  try {
    return await loadRunnerConfig(cwd);
  } catch (error) {
    result.warnings.push(
      `invalid bshopify.config.mjs: ${error instanceof Error ? error.message : String(error)}`,
    );
    return defaultRunnerConfig;
  }
}

async function removeRunnerConfigFile(cwd: string, result: ClearResult): Promise<void> {
  const targetPath = join(cwd, configFileName);

  if (!(await pathExists(targetPath))) {
    return;
  }

  await rm(targetPath, { force: true });
  result.removed.push(configFileName);
}

function createEmptyClearResult(): ClearResult {
  return {
    errors: [],
    removed: [],
    updated: [],
    warnings: [],
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
