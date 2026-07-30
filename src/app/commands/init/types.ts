export interface InitOptions {
  check?: boolean;
  cwd?: string;
  update?: boolean;
}

export type InitMode = "check" | "init" | "update";

export interface InitCheck {
  message: string;
  name: string;
  ok: boolean;
}

export interface InitResult {
  checks: InitCheck[];
  created: string[];
  errors: string[];
  mode?: InitMode;
  skipped: string[];
  updated: string[];
  warnings: string[];
}
