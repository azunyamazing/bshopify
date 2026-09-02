import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * The bshopify-managed entry template generated under each extension.
 *
 * This is a bshopify artifact (a hook file), not the Shopify extension
 * itself; the extension domain owns its template and lifecycle contract.
 */
export const managedEntryTemplate = `export default {
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
