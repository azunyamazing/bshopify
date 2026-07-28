import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

declare const __BSHOPIFY_PACKAGE_NAME__: string | undefined;
declare const __BSHOPIFY_PACKAGE_VERSION__: string | undefined;

export interface PackageInfo {
  name: string;
  version: string;
}

export interface PackageJson {
  name?: unknown;
  scripts?: Record<string, string>;
  version?: unknown;
  [key: string]: unknown;
}

export interface PackageJsonRequire {
  (id: string): unknown;
}

const require = createRequire(import.meta.url);

export const packageInfo: PackageInfo = readPackageInfo();

export async function readPackageJson(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, "utf8")) as PackageJson;
}

export function readPackageJsonWithRequire(
  requirePackage: PackageJsonRequire,
  path: string,
): PackageJson {
  return requirePackage(path) as PackageJson;
}

function readPackageInfo(): PackageInfo {
  const injectedPackageInfo = readInjectedPackageInfo();

  if (injectedPackageInfo !== undefined) {
    return injectedPackageInfo;
  }

  const packageJson = readPackageJsonWithRequire(require, "../../package.json");

  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    throw new Error("package.json must define string name and version fields.");
  }

  return {
    name: packageJson.name,
    version: packageJson.version,
  };
}

function readInjectedPackageInfo(): PackageInfo | undefined {
  if (
    typeof __BSHOPIFY_PACKAGE_NAME__ !== "string" ||
    typeof __BSHOPIFY_PACKAGE_VERSION__ !== "string"
  ) {
    return undefined;
  }

  return {
    name: __BSHOPIFY_PACKAGE_NAME__,
    version: __BSHOPIFY_PACKAGE_VERSION__,
  };
}
