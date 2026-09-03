import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * The bshopify-managed entry template generated under each extension.
 *
 * This is a bshopify artifact (a hook file), not the Shopify extension
 * itself; the extension domain owns its template and lifecycle contract.
 *
 * The template is intentionally typed for editors: `// @ts-check` plus a
 * JSDoc `@type` reference to the package's `ExtensionLifecycle` give full
 * hints for `ctx` / `plan` / `plans` / `result` / `error` while editing.
 * An entry that is still byte-identical to this template is a placeholder:
 * it has no runtime effect, so dev / deploy skip loading it.
 */
export const managedEntryTemplate = `// @ts-check
/**
 * bshopify-managed extension entry.
 *
 * Types come from the package itself: ctx / plan / plans / result are
 * inferred through the type reference below, so your editor gives
 * completion and errors while you edit this file.
 *
 * An entry that is still the generated template is a placeholder with no
 * runtime effect: dev / deploy skip loading and processing it entirely.
 * It only matters once you add injections or hook bodies.
 *
 * @type {import('@bestfulfill/bshopify').ExtensionLifecycle}
 */
export default {
  async prepare(ctx) {
    return {
      injections: [
        // {
        //   file: "blocks/app-embed.liquid",
        //   strategy: "replace",
        //   pattern: "__APP_URL__",
        //   value: ctx.appConfig.application_url,
        // },
      ],
    };
  },

  async validate(ctx, plan) {},

  async beforeDeploy(ctx, plan, plans) {},

  async afterDeploy(ctx, result) {},

  async onError(ctx, error) {},
};
`;

/**
 * True when the file is an untouched generated entry template. Such entries
 * have no runtime effect, so dev / deploy treat them as placeholders and
 * skip loading them.
 */
export async function isGeneratedEntry(path: string): Promise<boolean> {
  return await readFile(path, "utf8") === managedEntryTemplate;
}

export async function getGeneratedEntryContentHash(
  path: string,
): Promise<string | undefined> {
  const content = await readFile(path, "utf8");
  return content === managedEntryTemplate ? createContentHash(content) : undefined;
}

export function createContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
