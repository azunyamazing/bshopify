import { join } from "node:path";
import { loadShopifyAppConfig } from "./config";
import type { RunnerCommand, RunnerConfig, RunnerContextBase } from "./types";
import { normalizePathPart } from "../utils/extensions";

export interface CreateRunnerContextOptions {
  cwd: string;
  command: RunnerCommand;
  configName: string;
  runnerConfig: RunnerConfig;
}

export async function createRunnerContext(
  options: CreateRunnerContextOptions,
): Promise<RunnerContextBase> {
  const { command, configName, cwd, runnerConfig } = options;
  const configFile = runnerConfig.configFiles[configName];

  if (configFile === undefined || configFile.trim().length === 0) {
    throw new Error(`bshopify configFiles.${configName} is required.`);
  }

  const shopifyConfig = await loadShopifyAppConfig(join(cwd, configFile), configFile);
  const prefix = normalizePathPart(shopifyConfig.app_proxy.prefix);
  const subpath = normalizePathPart(shopifyConfig.app_proxy.subpath);
  const targetUrl = shopifyConfig.app_proxy.url.trim();

  if (!prefix || !subpath || !targetUrl) {
    throw new Error(`${configFile} must define [app_proxy].prefix, subpath, and url.`);
  }

  const apiBase = `/${prefix}/${subpath}`;
  const env = configName === "production" ? "prod" : configName;

  return {
    appProxy: {
      apiBase,
      prefix,
      subpath,
      targetUrl,
    },
    command,
    configName,
    env,
    extensionEnv: {
      APP_ENV: env,
      SHOPIFY_CONFIG_NAME: configName,
      SHOPIFY_APP_PROXY_BASE: apiBase,
      SHOPIFY_APP_PROXY_PREFIX: prefix,
      SHOPIFY_APP_PROXY_SUBPATH: subpath,
      SHOPIFY_APP_PROXY_TARGET_URL: targetUrl,
    },
    runtimeConfig: {},
    shopify: {
      appName: shopifyConfig.name,
      clientId: shopifyConfig.client_id,
      configFile,
    },
  };
}
