export interface ClearOptions {
  cwd?: string;
  yes?: boolean;
}

export interface ClearResult {
  errors: string[];
  removed: string[];
  updated: string[];
  warnings: string[];
}
