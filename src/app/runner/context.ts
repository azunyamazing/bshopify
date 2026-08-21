import { join } from "node:path";
import { getShopifyCliConfigName, loadShopifyAppConfig } from "./config";
import type { RunnerCommand, RunnerConfig, RunnerContextBase } from "./types";
import { normalizePathPart } from "#/utils/paths";

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

  const effectiveConfigName = getShopifyCliConfigName(configFile);
  const shopifyConfig = await loadShopifyAppConfig(join(cwd, configFile), configFile);
  const appProxy = shopifyConfig.app_proxy === undefined
    ? undefined
    : createAppProxyContext(shopifyConfig.app_proxy, configFile);
  const contextConfigName = effectiveConfigName ?? configName;
  const env = contextConfigName === "production" ? "prod" : contextConfigName;

  return {
    appProxy,
    command,
    configName: contextConfigName,
    env,
    extensionEnv: {
      APP_ENV: env,
      SHOPIFY_CONFIG_NAME: contextConfigName,
      SHOPIFY_APP_PROXY_BASE: appProxy?.apiBase,
      SHOPIFY_APP_PROXY_PREFIX: appProxy?.prefix,
      SHOPIFY_APP_PROXY_SUBPATH: appProxy?.subpath,
      SHOPIFY_APP_PROXY_TARGET_URL: appProxy?.targetUrl,
    },
    runtimeConfig: {},
    shopify: {
      applicationUrl: shopifyConfig.application_url,
      appName: shopifyConfig.name,
      cliConfigName: effectiveConfigName,
      clientId: shopifyConfig.client_id,
      configFile,
      importantConfig: shopifyConfig.importantConfig,
    },
  };
}

function createAppProxyContext(
  appProxy: { prefix: string; subpath: string; url: string },
  configFile: string,
) {
  const prefix = normalizePathPart(appProxy.prefix);
  const subpath = normalizePathPart(appProxy.subpath);
  const targetUrl = appProxy.url.trim();

  if (!prefix || !subpath || !targetUrl) {
    throw new Error(`${configFile} must define [app_proxy].prefix, subpath, and url.`);
  }

  return {
    apiBase: `/${prefix}/${subpath}`,
    prefix,
    subpath,
    targetUrl,
  };
}
