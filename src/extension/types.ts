import type { RunnerContextBase } from "#/app/runner/types";

/**
 * A Shopify extension living under the configured extensions root.
 *
 * This is the Shopify-owned artifact: bshopify discovers it, but does not
 * invent it. `ManagedEntry` (the per-extension `__entry.js`) is the
 * bshopify-owned artifact that plugs into it.
 */
export interface ExtensionInfo {
  name: string;
  root: string;
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

/**
 * A bshopify-managed entry file (`__entry.js`) inside an extension directory.
 *
 * The entry file is a bshopify artifact — not the Shopify extension itself —
 * so it is modeled as `ManagedEntry` instead of being conflated with
 * `ExtensionInfo`.
 */
export interface ManagedEntry {
  extension: ExtensionInfo;
  filePath: string;
}

export interface PreparedExtensionPlan {
  entry: ManagedEntry;
  extension: string;
  hooks: ExtensionLifecycle;
  injections: InjectionPlan[];
}

/**
 * The runtime context handed to one extension's `__entry` lifecycle: exactly
 * the app-level runner context (`configPath` / `env` / `appConfig`).
 */
export type ExtensionContext = RunnerContextBase;
