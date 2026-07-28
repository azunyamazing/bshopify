import { join } from "node:path";
import { isInsidePath } from "#/utils/paths";

export function normalizePathPart(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

export function resolveExtensionPath(extensionRoot: string, file: string): string {
  const targetPath = join(extensionRoot, file);

  if (!isInsidePath(extensionRoot, targetPath)) {
    throw new Error(`Injection file must stay inside extension root: ${file}`);
  }

  return targetPath;
}
