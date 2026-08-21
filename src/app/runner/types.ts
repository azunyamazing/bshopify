import type { ExtensionEnv } from "#/extension/types";

export type ShopifyCommandRunner = (args: string[]) => Promise<number | void>;

export interface DevOptions {
  configName?: string;
  cwd?: string;
  runShopifyCommand?: ShopifyCommandRunner;
  shopifyArgs?: string[];
}

export interface DeployOptions {
  configName?: string;
  confirmProduction?: boolean;
  cwd?: string;
  dryRun?: boolean;
  runShopifyCommand?: ShopifyCommandRunner;
  shopifyArgs?: string[];
  yes?: boolean;
}

/**
 * bshopify runner configuration loaded from `bshopify.config.mjs`.
 *
 * Only `configFiles` and `failOnUnresolvedPlaceholders` are meant to be
 * configured by the team. `extensionsRoot`, `entryFileName`, and
 * `restoreMarkers` are internal defaults: new projects do not expose them,
 * but existing configs may still override them for backward compatibility.
 */
export interface RunnerConfig {
  /** App: Shopify app config files by environment. */
  configFiles: ConfigFileMap;
  /** Internal default: bshopify-managed entry file name. */
  entryFileName: string;
  /** Internal default: directory that contains Shopify extension folders. */
  extensionsRoot: string;
  /** Extension: fail when an injection plan leaves template placeholders unresolved. */
  failOnUnresolvedPlaceholders: boolean;
  /** Internal default: add file-type-aware restore comments during dev. */
  restoreMarkers: boolean;
}

export interface ConfigFileMap {
  [key: string]: string;
}

export interface ShopifyAppProxyConfig {
  prefix: string;
  subpath: string;
  url: string;
}

export interface ShopifyAppConfig {
  app_proxy?: ShopifyAppProxyConfig;
  application_url?: string;
  client_id?: string;
  importantConfig: ShopifyImportantConfigItem[];
  name?: string;
}

export interface AppProxyContext {
  apiBase: string;
  prefix: string;
  subpath: string;
  targetUrl: string;
}

export interface ShopifyImportantConfigItem {
  label: string;
  value: string;
}

export type RunnerCommand = "dev" | "deploy" | "dryRun";

export interface ShopifyContext {
  applicationUrl?: string;
  appName?: string;
  cliConfigName?: string;
  clientId?: string;
  configFile: string;
  importantConfig: ShopifyImportantConfigItem[];
}

export interface RunnerContextBase {
  appProxy?: AppProxyContext;
  command: RunnerCommand;
  configName: string;
  env: string;
  extensionEnv: ExtensionEnv;
  runtimeConfig: RuntimeConfig;
  shopify: ShopifyContext;
}

export interface FileTransaction {
  hideFile(path: string): Promise<void>;
  restore(): Promise<void>;
  writeFile(path: string, content: string, replacement: ReverseReplacement): Promise<void>;
}

export interface ReverseReplacement {
  marker?: string;
  pattern: string;
  value: string;
}

export interface TrackedFile {
  path: string;
  replacements: ReverseReplacement[];
}

export interface HiddenFile {
  hiddenPath: string;
  path: string;
}

export interface RuntimeConfig {
  [key: string]: unknown;
}
