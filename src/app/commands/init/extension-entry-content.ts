import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extensionEntryTemplate } from "./constants";

export async function isGeneratedEntry(path: string): Promise<boolean> {
  return await readFile(path, "utf8") === extensionEntryTemplate;
}

export async function getGeneratedEntryContentHash(
  path: string,
): Promise<string | undefined> {
  const content = await readFile(path, "utf8");
  return content === extensionEntryTemplate ? createContentHash(content) : undefined;
}

export function createContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
