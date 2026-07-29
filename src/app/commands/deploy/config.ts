import { input, select } from "@inquirer/prompts";
import type { RunnerConfig, RunnerContextBase } from "#/app/runner/types";

export interface ProductionConfirmationOptions {
  confirmProduction: boolean;
  dryRun: boolean;
  yes: boolean;
}

export async function resolveConfigName(
  requestedConfigName: string | undefined,
  config: RunnerConfig,
): Promise<string> {
  const configNames = Object.keys(config.configFiles).filter(
    (configName) => config.configFiles[configName]?.trim(),
  );

  if (configNames.length === 0) {
    throw new Error("bshopify configFiles must define at least one deploy target.");
  }

  if (requestedConfigName !== undefined) {
    return normalizeConfigName(requestedConfigName);
  }

  return select({
    choices: configNames.map((configName) => ({
      name: `${configName}  ${config.configFiles[configName]}`,
      value: configName,
    })),
    message: "Select deploy config:",
  });
}

export async function requireProductionConfirmation(
  configName: string,
  options: ProductionConfirmationOptions,
): Promise<void> {
  if (configName !== "production" || options.dryRun || options.confirmProduction) {
    return;
  }

  if (options.yes) {
    throw new Error("Production deploy requires --confirm-production.");
  }

  const answer = await input({
    message: 'Type "production" to confirm production deploy:',
  });

  if (answer !== "production") {
    throw new Error("Production deploy requires --confirm-production.");
  }
}

export function assertShopifyDeployConfig(context: RunnerContextBase): void {
  assertRequiredShopifyField(context.shopify.configFile, "client_id", context.shopify.clientId);
  assertRequiredShopifyField(context.shopify.configFile, "name", context.shopify.appName);
  assertRequiredShopifyField(
    context.shopify.configFile,
    "application_url",
    context.shopify.applicationUrl,
  );
}

function normalizeConfigName(configName: string): string {
  return configName === "prod" ? "production" : configName;
}

function assertRequiredShopifyField(
  configFile: string,
  fieldName: string,
  value: string | undefined,
): void {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${configFile} ${fieldName} is required.`);
  }
}
