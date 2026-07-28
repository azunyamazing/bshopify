import { join } from "node:path";
import { loadOptionalDefaultExport, loadTomlConfig } from "#/utils/config";
import {
  isRecord,
  toNonEmptyString,
  toRequiredString,
  toStringRecord,
} from "#/utils/objects";
import type { RunnerConfig, ShopifyAppConfig } from "./types";

export const defaultRunnerConfig: RunnerConfig = {
  configFiles: {
    dev: "shopify.app.dev.toml",
    test: "shopify.app.test.toml",
    production: "shopify.app.production.toml",
  },
  entryFileName: "__entry.js",
  extensionsRoot: "extensions",
  failOnUnresolvedPlaceholders: true,
  tmpRoot: ".bshopify-tmp",
};

export async function loadRunnerConfig(cwd: string): Promise<RunnerConfig> {
  const configPath = join(cwd, "bshopify.config.mjs");
  const configModule = await loadOptionalDefaultExport(configPath);
  const loaded = isRecord(configModule) ? configModule : {};
  const configFiles = isRecord(loaded.configFiles)
    ? {
        ...defaultRunnerConfig.configFiles,
        ...toStringRecord(loaded.configFiles),
      }
    : defaultRunnerConfig.configFiles;

  return {
    configFiles,
    entryFileName: toNonEmptyString(loaded.entryFileName, defaultRunnerConfig.entryFileName),
    extensionsRoot: toNonEmptyString(loaded.extensionsRoot, defaultRunnerConfig.extensionsRoot),
    failOnUnresolvedPlaceholders:
      typeof loaded.failOnUnresolvedPlaceholders === "boolean"
        ? loaded.failOnUnresolvedPlaceholders
        : defaultRunnerConfig.failOnUnresolvedPlaceholders,
    tmpRoot: toNonEmptyString(loaded.tmpRoot, defaultRunnerConfig.tmpRoot),
  };
}

export async function loadShopifyAppConfig(
  configPath: string,
  displayPath: string,
): Promise<ShopifyAppConfig> {
  return loadShopifyAppConfigRecord(await loadTomlConfig(configPath), displayPath);
}

function loadShopifyAppConfigRecord(value: unknown, displayPath: string): ShopifyAppConfig {
  if (!isRecord(value)) {
    throw new Error(`${displayPath} must be a TOML object.`);
  }

  if (!isRecord(value.app_proxy)) {
    throw new Error(`${displayPath} must define [app_proxy].`);
  }

  return {
    app_proxy: {
      prefix: toRequiredString(value.app_proxy.prefix, `${displayPath} [app_proxy].prefix`),
      subpath: toRequiredString(value.app_proxy.subpath, `${displayPath} [app_proxy].subpath`),
      url: toRequiredString(value.app_proxy.url, `${displayPath} [app_proxy].url`),
    },
    client_id: typeof value.client_id === "string" ? value.client_id : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
  };
}
