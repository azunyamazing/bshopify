import { loadRunnerConfig } from "#/app/runner/config";
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
} from "#/app/runner/injections";
import { acquireLock } from "#/app/runner/lock";
import { runShopifyCommand as runDefaultShopifyCommand } from "#/app/runner/shopify";
import { createFileTransaction } from "#/app/runner/transaction";
import type { DevOptions, ExtensionContext, ShopifyCommandRunner } from "#/app/runner/types";

export async function devProject(options: DevOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configName = options.configName ?? "dev";
  const config = await loadRunnerConfig(cwd);
  const context = await createRunnerContext({
    command: "dev",
    configName,
    cwd,
    runnerConfig: config,
  });
  const entries = await findExtensionEntries(cwd, config);
  const hooks = await loadExtensionHooks(entries);
  const plans = await preparePlans(context, hooks);
  await validatePlans(context, plans);

  const lock = await acquireLock(cwd, config.tmpRoot);
  const transaction = await createFileTransaction();

  try {
    for (const plan of plans) {
      await applyInjections(cwd, plan, transaction);
    }

    if (config.failOnUnresolvedPlaceholders) {
      await assertNoUnresolvedPlaceholders(cwd, config.extensionsRoot);
    }

    const runShopifyCommand =
      options.runShopifyCommand ?? ((args) => runDefaultShopifyCommand(args, cwd));
    const exitCode = await runShopifyCommand([
      "app",
      "dev",
      "--config",
      configName,
      ...(options.shopifyArgs ?? []),
    ]);

    return exitCode ?? 0;
  } finally {
    try {
      await transaction.restore();
    } finally {
      await lock.release();
    }
  }
}
