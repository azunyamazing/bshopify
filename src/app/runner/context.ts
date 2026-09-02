import { join } from "node:path";
import { loadTomlConfig } from "#/utils/config";
import { isRecord } from "#/utils/objects";
import { formatEnvFilesSummary, loadEnvNamespaces } from "./env-files";
import type { RunnerConfig, RunnerContextBase } from "./types";

export interface CreateRunnerContextOptions {
  cwd: string;
  configName: string;
  runnerConfig: RunnerConfig;
}

export interface CreateRunnerContextResult {
  context: RunnerContextBase;
  envFileSummary: string | undefined;
  envFileWarnings: string[];
}

/** Built-in context fields that `envFiles` namespaces must never shadow. */
const RESERVED_CONTEXT_KEYS = new Set(["configPath", "env", "appConfig"]);
const CONTEXT_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Composes the runner context from the selected `bshopify.config.mjs`
 * `configFiles` entry: the TOML file name, the environment name, and the raw
 * TOML contents passed through as-is. Every `envFiles` namespace is loaded
 * and attached as its own context field (`ctx.<key>`). No console output is
 * emitted here; the caller prints `envFileSummary` / `envFileWarnings`.
 */
export async function createRunnerContext(
  options: CreateRunnerContextOptions,
): Promise<CreateRunnerContextResult> {
  const { configName, cwd, runnerConfig } = options;
  const configPath = runnerConfig.configFiles[configName];

  if (configPath === undefined || configPath.trim().length === 0) {
    throw new Error(`bshopify configFiles.${configName} is required.`);
  }

  const appConfig = await loadTomlConfig(join(cwd, configPath));

  if (!isRecord(appConfig)) {
    throw new Error(`${configPath} must be a TOML object.`);
  }

  const context: RunnerContextBase = {
    configPath,
    env: configName,
    appConfig,
  };
  const { namespaces, warnings } = await loadEnvNamespaces(cwd, runnerConfig.envFiles);

  for (const [key, namespace] of Object.entries(namespaces)) {
    if (!isSafeContextKey(key)) {
      throw new Error(`bshopify envFiles key "${key}" is reserved.`);
    }

    context[key] = namespace.contents;
  }

  return {
    context,
    envFileSummary: formatEnvFilesSummary(namespaces),
    envFileWarnings: warnings,
  };
}

function isSafeContextKey(key: string): boolean {
  return CONTEXT_KEY_PATTERN.test(key)
    && !RESERVED_CONTEXT_KEYS.has(key)
    && !(key in Object.prototype);
}
