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

export interface RunnerConfig {
  configFiles: ConfigFileMap;
  entryFileName: string;
  extensionsRoot: string;
  failOnUnresolvedPlaceholders: boolean;
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

export interface ExtensionEnv {
  APP_ENV: string;
  SHOPIFY_APP_PROXY_BASE?: string;
  SHOPIFY_APP_PROXY_PREFIX?: string;
  SHOPIFY_APP_PROXY_SUBPATH?: string;
  SHOPIFY_APP_PROXY_TARGET_URL?: string;
  SHOPIFY_CONFIG_NAME: string;
}

export interface ExtensionInfo {
  name: string;
  root: string;
}

export interface ExtensionContext {
  appProxy?: AppProxyContext;
  command: RunnerCommand;
  configName: string;
  env: string;
  extension: ExtensionInfo;
  extensionEnv: ExtensionEnv;
  runtimeConfig: RuntimeConfig;
  shopify: ShopifyContext;
}

export interface InjectionPlan {
  file: string;
  pattern: string;
  strategy: "replace";
  value: unknown;
}

export interface ExtensionPlanResult {
  extension?: string;
  injections: InjectionPlan[];
}

export interface ExtensionLifecycle {
  prepare(ctx: ExtensionContext): ExtensionPlanResult | Promise<ExtensionPlanResult>;
  afterDeploy?(
    ctx: ExtensionContext,
    result: ExtensionDeployResult,
  ): void | Promise<void>;
  beforeDeploy?(
    ctx: ExtensionContext,
    plan: PreparedExtensionPlan,
    plans: PreparedExtensionPlan[],
  ): void | Promise<void>;
  onError?(ctx: ExtensionContext, error: unknown): void | Promise<void>;
  validate?(
    ctx: ExtensionContext,
    plan: PreparedExtensionPlan,
    plans: PreparedExtensionPlan[],
  ): void | Promise<void>;
}

export interface ExtensionDeployResult {
  deployed: boolean;
  dryRun: boolean;
  exitCode: number;
}

export interface ExtensionEntry {
  extension: ExtensionInfo;
  filePath: string;
}

export interface PreparedExtensionPlan {
  entry: ExtensionEntry;
  extension: string;
  hooks: ExtensionLifecycle;
  injections: InjectionPlan[];
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
