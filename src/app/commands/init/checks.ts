import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { isNodeError } from "#/utils/node";
import type { InitResult } from "./types";

export interface ProjectCheckOptions {
  configFiles: string[];
  extensionsRoot: string;
}

export async function runProjectChecks(
  cwd: string,
  result: InitResult,
  options: ProjectCheckOptions,
): Promise<void> {
  await checkOptionalPath(
    cwd,
    options.extensionsRoot,
    `found ${options.extensionsRoot} directory`,
    result,
  );

  for (const fileName of options.configFiles) {
    await checkPath(cwd, fileName, `found ${fileName}`, result);
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

async function checkOptionalPath(
  cwd: string,
  name: string,
  successMessage: string,
  result: InitResult,
): Promise<void> {
  try {
    await access(join(cwd, name), constants.F_OK);
    result.checks.push({ name, ok: true, message: successMessage });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}
