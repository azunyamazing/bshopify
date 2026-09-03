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
 * Only `configFiles`, `envFiles`, and `failOnUnresolvedPlaceholders` are
 * meant to be configured by the team. `extensionsRoot`, `entryFileName`, and
 * `restoreMarkers` are internal defaults: new projects do not expose them,
 * but existing configs may still override them for backward compatibility.
 */
export interface RunnerConfig {
  /** App: Shopify app config files by environment. */
  configFiles: ConfigFileMap;
  /** Extension: custom env namespaces injected into the runner context. */
  envFiles: EnvFilesConfig;
  /** Internal default: bshopify-managed entry file name. */
  entryFileName: string;
  /** Internal default: directory that contains Shopify extension folders. */
  extensionsRoot: string;
  /** Extension: fail when an injection plan leaves template placeholders unresolved. */
  failOnUnresolvedPlaceholders: boolean;
  /** Internal default: add file-type-aware restore comments during dev. */
  restoreMarkers: boolean;
}

/**
 * Custom env namespaces for extension injection, configured as
 * `envFiles` in `bshopify.config.mjs`: key → one or more root-relative
 * JSON/TOML file paths. Each key becomes its own field on the runner context
 * (e.g. `aEnv` → `ctx.aEnv`), with the referenced file contents merged.
 */
export interface EnvFilesConfig {
  [key: string]: string | string[];
}

export interface ConfigFileMap {
  [key: string]: string;
}

/**
 * The runtime context handed to app orchestration and to each extension's
 * `__entry` lifecycle. `configPath` / `env` / `appConfig` come from the
 * enabled Shopify app TOML; every additional key is a custom env namespace
 * injected from `bshopify.config.mjs` `envFiles` (key → merged file contents).
 */
export interface RunnerContextBase {
  /** Currently enabled Shopify app TOML file name (`configFiles.<env>` value). */
  configPath: string;
  /** The `configFiles` key of the current environment (e.g. `dev`, `test`, `production`). */
  env: string;
  /** Parsed contents of the TOML file, passed through as-is. */
  appConfig: Record<string, unknown>;
  /** Custom env namespaces injected from `envFiles` (key → merged contents). */
  [envNamespace: string]: unknown;
}

export interface FileTransaction {
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
