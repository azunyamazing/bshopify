import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parse } from "smol-toml";
import { isNodeError } from "./node";

export async function loadOptionalDefaultExport(path: string): Promise<unknown | undefined> {
  try {
    await stat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  const module = await import(`${pathToFileURL(path).href}?t=${randomUUID()}`);
  return module.default;
}

export async function loadTomlConfig(path: string): Promise<unknown> {
  return parse(await readFile(path, "utf8"));
}
