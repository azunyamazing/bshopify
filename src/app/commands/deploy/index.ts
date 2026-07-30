import { join } from "node:path";
import { confirm } from "@inquirer/prompts";
import { bshopifyStateDir } from "#/app/runner/constants";
import { formatShopifyCliConfigArgs, loadRunnerConfig } from "#/app/runner/config";
import { createRunnerContext } from "#/app/runner/context";
import {
  findExtensionEntries,
  loadExtensionHooks,
  preparePlans,
  runAfterDeployHooks,
  runBeforeDeployHooks,
  runOnErrorHooks,
  validatePlans,
} from "#/app/runner/entries";
import {
  applyInjections,
  assertNoUnresolvedPlaceholders,
  formatAppliedInjections,
} from "#/app/runner/injections";
import { acquireLock } from "#/app/runner/lock";
import { runShopifyCommand as runDefaultShopifyCommand } from "#/app/runner/shopify";
import {
  createFileTransaction,
  restoreFileTransactionJournal,
} from "#/app/runner/transaction";
import {
  assertShopifyDeployConfig,
  requireProductionConfirmation,
  resolveConfigName,
} from "./config";
import { formatDeploySummary, formatRestoreNotice } from "./summary";
import type { AppliedInjection } from "#/app/runner/injections";
import type {
  DeployOptions,
  ShopifyCommandRunner,
} from "#/app/runner/types";

export async function deployProject(options: DeployOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadRunnerConfig(cwd);
  const configName = await resolveConfigName(options.configName, config);
  const dryRun = options.dryRun === true;

  const context = await createRunnerContext({
    command: dryRun ? "dryRun" : "deploy",
    configName,
    cwd,
    runnerConfig: config,
  });
  assertShopifyDeployConfig(context);
  const lock = await acquireLock(cwd, bshopifyStateDir);
  const transactionPath = join(cwd, bshopifyStateDir, "extension-prepare.transaction.json");

  try {
    if (lock.recoveredStaleLock) {
      const restored = await restoreFileTransactionJournal(transactionPath);
      console.warn(
        restored
          ? "Detected a stale Shopify extension prepare lock. Restored previous injections and cleaned it automatically."
          : "Detected a stale Shopify extension prepare lock. Cleaned it automatically.",
      );
    }

    const entries = await findExtensionEntries(cwd, config);
    const hooks = await loadExtensionHooks(entries);
    const plans = await preparePlans(context, hooks);
    await validatePlans(context, plans);

    console.log(formatDeploySummary(context, entries, dryRun));

    await requireProductionConfirmation(configName, {
      confirmProduction: options.confirmProduction === true,
      dryRun,
      yes: options.yes === true,
    });

    if (!dryRun && options.yes !== true) {
      const shouldDeploy = await confirm({
        default: false,
        message: `Deploy ${context.configName} with ${context.shopify.configFile}?`,
      });

      if (!shouldDeploy) {
        return 0;
      }
    }

    const transaction = await createFileTransaction(transactionPath);
    const appliedInjections: AppliedInjection[] = [];

    try {
      for (const plan of plans) {
        appliedInjections.push(
          ...(await applyInjections(cwd, plan, transaction, {
            mode: dryRun ? "dryRun" : "deploy",
            restoreMarkers: false,
          })),
        );
      }

      const injectionSummary = formatAppliedInjections(appliedInjections, {
        configName: context.shopify.cliConfigName,
        cwd,
        mode: dryRun ? "dryRun" : "deploy",
      });

      if (injectionSummary !== undefined) {
        console.log(injectionSummary);
      }

      if (config.failOnUnresolvedPlaceholders) {
        await assertNoUnresolvedPlaceholders(cwd, config.extensionsRoot);
      }

      await runBeforeDeployHooks(context, plans);

      let exitCode = 0;

      if (!dryRun) {
        for (const entry of entries) {
          await transaction.hideFile(entry.filePath);
        }

        const runShopifyCommand = createShopifyDeployRunner(options.runShopifyCommand, cwd);
        console.log("");
        exitCode =
          (await runShopifyCommand([
            "app",
            "deploy",
            ...formatShopifyCliConfigArgs(context.shopify.cliConfigName),
            ...(options.shopifyArgs ?? []),
          ])) ?? 0;
      }

      await runAfterDeployHooks(context, plans, {
        deployed: !dryRun,
        dryRun,
        exitCode,
      });

      return exitCode;
    } catch (error) {
      await runOnErrorHooks(context, plans, error);
      throw error;
    } finally {
      await transaction.restore();
      if (appliedInjections.length > 0 || entries.length > 0) {
        console.log(formatRestoreNotice(dryRun));
      }
    }
  } finally {
    await lock.release();
  }
}

function createShopifyDeployRunner(
  runShopifyCommand: ShopifyCommandRunner | undefined,
  cwd: string,
): ShopifyCommandRunner {
  return runShopifyCommand ?? ((args) => runDefaultShopifyCommand(args, cwd));
}
