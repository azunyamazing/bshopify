import { createRequire } from "node:module";

export interface PackageInfo {
  name: string;
  version: string;
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
}

const require = createRequire(import.meta.url);

export const packageInfo: PackageInfo = readPackageInfo();

function readPackageInfo(): PackageInfo {
  const packageJson = require("../package.json") as PackageJson;

  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    throw new Error("package.json must define string name and version fields.");
  }

  return {
    name: packageJson.name,
    version: packageJson.version,
  };
}
