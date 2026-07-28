export type ShopifyCommandRunner = (args: string[]) => Promise<number | void>;

export interface DevOptions {
  configName?: string;
  cwd?: string;
  runShopifyCommand?: ShopifyCommandRunner;
  shopifyArgs?: string[];
}

export interface RunnerConfig {
  configFiles: ConfigFileMap;
  entryFileName: string;
  extensionsRoot: string;
  failOnUnresolvedPlaceholders: boolean;
  tmpRoot: string;
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
  app_proxy: ShopifyAppProxyConfig;
  client_id?: string;
  name?: string;
}

export interface AppProxyContext {
  apiBase: string;
  prefix: string;
  subpath: string;
  targetUrl: string;
}

export type RunnerCommand = "dev" | "deploy" | "dryRun";

export interface ShopifyContext {
  appName?: string;
  clientId?: string;
  configFile: string;
}

export interface ExtensionEnv {
  APP_ENV: string;
  SHOPIFY_APP_PROXY_BASE: string;
  SHOPIFY_APP_PROXY_PREFIX: string;
  SHOPIFY_APP_PROXY_SUBPATH: string;
  SHOPIFY_APP_PROXY_TARGET_URL: string;
  SHOPIFY_CONFIG_NAME: string;
}

export interface ExtensionInfo {
  name: string;
  root: string;
}

export interface ExtensionContext {
  appProxy: AppProxyContext;
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
  validate?(
    ctx: ExtensionContext,
    plan: PreparedExtensionPlan,
    plans: PreparedExtensionPlan[],
  ): void | Promise<void>;
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
  appProxy: AppProxyContext;
  command: RunnerCommand;
  configName: string;
  env: string;
  extensionEnv: ExtensionEnv;
  runtimeConfig: RuntimeConfig;
  shopify: ShopifyContext;
}

export interface FileTransaction {
  restore(): Promise<void>;
  writeFile(path: string, content: string, replacement: ReverseReplacement): Promise<void>;
}

export interface ReverseReplacement {
  marker: string;
  pattern: string;
  value: string;
}

export interface TrackedFile {
  path: string;
  replacements: ReverseReplacement[];
}

export interface RuntimeConfig {
  [key: string]: unknown;
}
