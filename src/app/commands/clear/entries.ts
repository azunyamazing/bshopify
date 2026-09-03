import { constants } from "node:fs";
import { access, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { isGeneratedEntry } from "#/extension/manage-content";
import { formatPath, isInsidePath, resolvePath } from "#/utils/paths";
import { isNodeError } from "#/utils/node";
import type { InitManifest } from "#/app/commands/init/manifest";
import type { RunnerConfig } from "#/app/runner/types";
import type { ClearResult } from "./types";

/**
 * Removes the extension entry files that bshopify generated and recorded in
 * the init manifest. Only files that are still byte-identical to the managed
 * template are deleted; customized entries are user code and are kept with a
 * warning. Manifest paths that cannot be verified to live inside the
 * extension directory are never touched.
 */
export async function removeManagedExtensionEntries(
  cwd: string,
  result: ClearResult,
  config: RunnerConfig,
  manifest: InitManifest,
): Promise<void> {
  for (const [extensionName, entry] of Object.entries(manifest.entries)) {
    const manifestPath = entry?.path;

    if (typeof manifestPath !== "string" || manifestPath.length === 0) {
      continue;
    }

    if (isAbsolute(manifestPath)) {
      result.warnings.push(`ignored manifest entry outside extension directory: ${manifestPath}`);
      continue;
    }

    const targetPath = resolvePath(cwd, manifestPath);
    const extensionRoot = resolvePath(cwd, join(config.extensionsRoot, extensionName));
    if (!isInsidePath(extensionRoot, targetPath)) {
      result.warnings.push(`ignored manifest entry outside extension directory: ${manifestPath}`);
      continue;
    }

    if (!(await pathExists(targetPath))) {
      continue;
    }

    if (await isGeneratedEntry(targetPath)) {
      await rm(targetPath, { force: true });
      result.removed.push(formatPath(cwd, targetPath));
    } else {
      result.warnings.push(`kept custom extension entry ${formatPath(cwd, targetPath)}`);
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
