import type { ShopifyCommandRunner } from "#/app/runner/types";

export interface InitOptions {
  check?: boolean;
  cwd?: string;
  runShopifyCommand?: ShopifyCommandRunner;
}

export interface InitCheck {
  message: string;
  name: string;
  ok: boolean;
}

export interface InitResult {
  checks: InitCheck[];
  created: string[];
  errors: string[];
  skipped: string[];
  updated: string[];
  warnings: string[];
}
