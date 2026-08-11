import { join } from "node:path";
import { bshopifyStateDir } from "#/app/runner/constants";
import { formatShopifyCliConfigArgs, loadRunnerConfig } from "#/app/runner/config";
import { createRunnerContext } from "#/app/runner/context";
import {
  findExtensionEntries,
  loadExtensionHooks,
  preparePlans,
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
import { ansi, colorize } from "#/utils/output";
import type { AppliedInjection } from "#/app/runner/injections";
import type { DevOptions, ExtensionContext, ShopifyCommandRunner } from "#/app/runner/types";

export async function devProject(options: DevOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configName = options.configName ?? "dev";
  const shopifyArgs = options.shopifyArgs ?? [];
  const shouldForwardCliConfig = options.configName !== undefined || shopifyArgs.length === 0;
  const config = await loadRunnerConfig(cwd);
  const context = await createRunnerContext({
    command: "dev",
    configName,
    cwd,
    runnerConfig: config,
  });
  const lock = await acquireLock(cwd, bshopifyStateDir);
  const transactionPath = join(cwd, bshopifyStateDir, "extension-prepare.transaction.json");

  try {
    if (lock.recoveredStaleLock) {
      const restored = await restoreFileTransactionJournal(transactionPath);
      console.warn(
        restored
          ? "Detected a stale Shopify extension prepare lock, likely from a killed dev process. Restored previous injections and cleaned it automatically."
          : "Detected a stale Shopify extension prepare lock, likely from a killed dev process. Cleaned it automatically.",
      );
    }

    const entries = await findExtensionEntries(cwd, config);
    const hooks = await loadExtensionHooks(entries);
    const plans = await preparePlans(context, hooks);
    await validatePlans(context, plans);

    const transaction = await createFileTransaction(transactionPath);
    const appliedInjections: AppliedInjection[] = [];

    try {
      for (const plan of plans) {
        appliedInjections.push(
          ...(await applyInjections(cwd, plan, transaction, {
            mode: "dev",
            restoreMarkers: config.restoreMarkers,
          })),
        );
      }

      const injectionSummary = formatAppliedInjections(appliedInjections, {
        configName: shouldForwardCliConfig ? context.shopify.cliConfigName : undefined,
        cwd,
      });

      if (injectionSummary !== undefined) {
        console.log(injectionSummary);
      }

      if (config.failOnUnresolvedPlaceholders) {
        await assertNoUnresolvedPlaceholders(cwd, config.extensionsRoot);
      }

      const runShopifyCommand =
        options.runShopifyCommand ?? ((args) => runDefaultShopifyCommand(args, cwd));
      const exitCode = await runShopifyCommand([
        "app",
        "dev",
        ...(shouldForwardCliConfig ? formatShopifyCliConfigArgs(context.shopify.cliConfigName) : []),
        ...shopifyArgs,
      ]);

      return exitCode ?? 0;
    } finally {
      await transaction.restore();
      if (appliedInjections.length > 0) {
        console.log(formatRestoreNotice());
      }
    }
  } finally {
    await lock.release();
  }
}

function formatRestoreNotice(): string {
  return `\n${colorize(colorize("Dev extension files restored.", ansi.cyan), ansi.bold)}\n`;
}
