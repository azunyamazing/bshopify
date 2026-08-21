import { join } from "node:path";
import { isInsidePath } from "#/utils/paths";

/**
 * Resolves an injection target file inside an extension root, rejecting any
 * path that would escape the extension directory.
 */
export function resolveExtensionPath(extensionRoot: string, file: string): string {
  const targetPath = join(extensionRoot, file);

  if (!isInsidePath(extensionRoot, targetPath)) {
    throw new Error(`Injection file must stay inside extension root: ${file}`);
  }

  return targetPath;
}
