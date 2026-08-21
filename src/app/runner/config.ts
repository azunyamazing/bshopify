import { basename, join } from "node:path";
import { loadOptionalDefaultExport, loadTomlConfig } from "#/utils/config";
import {
  isRecord,
  toNonEmptyString,
  toRequiredString,
  toStringRecord,
} from "#/utils/objects";
import type { ShopifyImportantConfigItem, RunnerConfig, ShopifyAppConfig } from "./types";

export const defaultRunnerConfig: RunnerConfig = {
  configFiles: {
    dev: "shopify.app.dev.toml",
    test: "shopify.app.test.toml",
    production: "shopify.app.production.toml",
  },
  // Internal defaults: not exposed in generated configs, but still loadable
  // from existing configs for backward compatibility.
  entryFileName: "__entry.js",
  extensionsRoot: "extensions",
  failOnUnresolvedPlaceholders: true,
  restoreMarkers: true,
};

export async function loadRunnerConfig(cwd: string): Promise<RunnerConfig> {
  const configPath = join(cwd, "bshopify.config.mjs");
  const configModule = await loadOptionalDefaultExport(configPath);
  const loaded = isRecord(configModule) ? configModule : {};
  const configFiles = isRecord(loaded.configFiles)
    ? validateConfigFiles(toStringRecord(loaded.configFiles))
    : defaultRunnerConfig.configFiles;

  return {
    configFiles,
    entryFileName: toNonEmptyString(loaded.entryFileName, defaultRunnerConfig.entryFileName),
    extensionsRoot: toNonEmptyString(loaded.extensionsRoot, defaultRunnerConfig.extensionsRoot),
    failOnUnresolvedPlaceholders:
      typeof loaded.failOnUnresolvedPlaceholders === "boolean"
        ? loaded.failOnUnresolvedPlaceholders
        : defaultRunnerConfig.failOnUnresolvedPlaceholders,
    restoreMarkers:
      typeof loaded.restoreMarkers === "boolean"
        ? loaded.restoreMarkers
        : defaultRunnerConfig.restoreMarkers,
  };
}

export async function loadShopifyAppConfig(
  configPath: string,
  displayPath: string,
): Promise<ShopifyAppConfig> {
  return loadShopifyAppConfigRecord(await loadTomlConfig(configPath), displayPath);
}

export function getShopifyCliConfigName(configFile: string): string | undefined {
  const fileName = basename(configFile);
  const withoutToml = fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;

  if (withoutToml === "shopify.app") {
    return undefined;
  }

  return withoutToml.startsWith("shopify.app.")
    ? withoutToml.slice("shopify.app.".length)
    : withoutToml;
}

export function formatShopifyCliConfigArgs(configName: string | undefined): string[] {
  return configName === undefined ? [] : ["--config", configName];
}

function validateConfigFiles(configFiles: Record<string, string>): Record<string, string> {
  for (const [configName, configFile] of Object.entries(configFiles)) {
    if (configFile.trim().length === 0) {
      continue;
    }

    if (!isRootShopifyAppConfigFile(configFile)) {
      throw new Error(
        `bshopify configFiles.${configName} must be a root-level Shopify app config file: shopify.app.toml or shopify.app.<name>.toml.`,
      );
    }
  }

  return configFiles;
}

function isRootShopifyAppConfigFile(configFile: string): boolean {
  return (
    basename(configFile) === configFile
    && /^shopify\.app(?:\.[^/\\]+)?\.toml$/.test(configFile)
  );
}

function loadShopifyAppConfigRecord(value: unknown, displayPath: string): ShopifyAppConfig {
  if (!isRecord(value)) {
    throw new Error(`${displayPath} must be a TOML object.`);
  }

  const appProxy = isRecord(value.app_proxy)
    ? {
        prefix: toRequiredString(value.app_proxy.prefix, `${displayPath} [app_proxy].prefix`),
        subpath: toRequiredString(value.app_proxy.subpath, `${displayPath} [app_proxy].subpath`),
        url: toRequiredString(value.app_proxy.url, `${displayPath} [app_proxy].url`),
      }
    : undefined;

  return {
    app_proxy: appProxy,
    application_url: typeof value.application_url === "string" ? value.application_url : undefined,
    client_id: typeof value.client_id === "string" ? value.client_id : undefined,
    importantConfig: collectImportantConfig(value),
    name: typeof value.name === "string" ? value.name : undefined,
  };
}

function collectImportantConfig(value: Record<string, unknown>): ShopifyImportantConfigItem[] {
  const items: ShopifyImportantConfigItem[] = [];

  pushStringItem(items, "application_url", value.application_url);

  if (isRecord(value.webhooks)) {
    pushStringItem(items, "webhooks.api_version", value.webhooks.api_version);
    pushStringArrayItem(items, "webhooks.topics", value.webhooks.topics);

    if (Array.isArray(value.webhooks.subscriptions)) {
      value.webhooks.subscriptions.forEach((subscription, index) => {
        if (!isRecord(subscription)) {
          return;
        }

        pushStringArrayItem(
          items,
          `webhooks.subscriptions[${index}].topics`,
          subscription.topics,
        );
        pushStringItem(items, `webhooks.subscriptions[${index}].uri`, subscription.uri);
      });
    }
  }

  return items;
}

function pushStringItem(
  items: ShopifyImportantConfigItem[],
  label: string,
  value: unknown,
): void {
  if (typeof value === "string" && value.trim().length > 0) {
    items.push({ label, value: value.trim() });
  }
}

function pushStringArrayItem(
  items: ShopifyImportantConfigItem[],
  label: string,
  value: unknown,
): void {
  if (!Array.isArray(value)) {
    return;
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );

  if (strings.length > 0) {
    items.push({ label, value: strings.join(", ") });
  }
}
