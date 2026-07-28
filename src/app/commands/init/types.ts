export interface InitOptions {
  check?: boolean;
  cwd?: string;
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
