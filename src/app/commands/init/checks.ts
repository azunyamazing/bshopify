import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isNodeError } from "#/utils/node";
import { requiredShopifyConfigFiles } from "./constants";
import type { InitResult } from "./types";

export async function runProjectChecks(cwd: string, result: InitResult): Promise<void> {
  await checkPath(cwd, "package.json", "found package.json", result);
  await checkPath(cwd, "extensions", "found extensions directory", result);

  for (const fileName of requiredShopifyConfigFiles) {
    await checkPath(cwd, fileName, `found ${fileName}`, result);
  }

  const extensionNames = await readExtensionNames(cwd);
  if (extensionNames.length === 0) {
    result.checks.push({
      name: "extensions/*",
      ok: false,
      message: "no extension directories found",
    });
    result.errors.push("no extension directories found under extensions/");
  }
}

export async function readExtensionNames(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, "extensions"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function checkPath(
  cwd: string,
  name: string,
  successMessage: string,
  result: InitResult,
): Promise<void> {
  try {
    await access(join(cwd, name), constants.F_OK);
    result.checks.push({ name, ok: true, message: successMessage });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }

    result.checks.push({ name, ok: false, message: `missing ${name}` });
    result.errors.push(`missing ${name}`);
  }
}
