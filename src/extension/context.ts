import type { RunnerContextBase } from "#/app/runner/types";
import { toPosixPath } from "#/utils/paths";
import type { ExtensionContext, ManagedEntry } from "./types";

/**
 * Composes the app-level context (`RunnerContextBase`) with one extension,
 * producing the per-extension context the extension lifecycle receives.
 *
 * This is the seam where the app domain (context provider) meets the
 * extension domain (context consumer): the extension domain owns the
 * composition, the app domain only supplies the base.
 */
export function createExtensionContext(
  context: RunnerContextBase,
  entry: ManagedEntry,
): ExtensionContext {
  return {
    ...context,
    extension: {
      name: entry.extension.name,
      root: toPosixPath(entry.extension.root),
    },
  };
}
