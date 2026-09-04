import { readFile } from "node:fs/promises";

/**
 * The bshopify-managed entry template generated under each extension.
 *
 * This is a bshopify artifact (a hook file), not the Shopify extension
 * itself; the extension domain owns its template and lifecycle contract.
 *
 * The template is intentionally typed for editors: `// @ts-check` plus
 * self-contained JSDoc typedefs (no package import) give hints for
 * `ctx` / `plan` / `plans` / `result` / `error` whether bshopify is
 * installed in this project or only available globally.
 * An entry that is still byte-identical to this template is a placeholder:
 * it has no runtime effect, so dev / deploy skip loading it.
 */
export const managedEntryTemplate = `// @ts-check
/**
 * bshopify-managed extension entry.
 *
 * The typedefs below are self-contained (no package import), so editors
 * type-check this file whether bshopify is installed in this project or
 * only available as a global install: ctx / plan / plans / result / error
 * are inferred while you edit the hook bodies.
 *
 * An entry that is still the generated template is a placeholder with no
 * runtime effect: dev / deploy skip loading and processing it entirely.
 * It only matters once you add injections or hook bodies.
 *
 * @typedef {Object} BshopifyExtensionContext
 * @property {string} configPath Currently enabled Shopify app TOML file name.
 * @property {string} env The \`configFiles\` key of the current environment (dev / test / production).
 * @property {Object.<string, *>} appConfig Parsed contents of the TOML file.
 *
 * @typedef {Object} BshopifyInjectionPlan
 * @property {string} file Root-relative target file.
 * @property {string} pattern Template placeholder to replace.
 * @property {'replace'} strategy Replacement strategy.
 * @property {*} value Value to inject.
 *
 * @typedef {Object} BshopifyExtensionPlanResult
 * @property {string} [extension] Extension name the plan belongs to.
 * @property {BshopifyInjectionPlan[]} injections Injections to apply.
 *
 * @typedef {Object} BshopifyExtensionDeployResult
 * @property {boolean} deployed Whether the deploy ran.
 * @property {boolean} dryRun Whether this was a dry run.
 * @property {number} exitCode Shopify CLI exit code.
 *
 * @typedef {Object} BshopifyPreparedExtensionPlan
 * @property {string} extension Extension name.
 * @property {BshopifyInjectionPlan[]} injections Injections to apply.
 *
 * @typedef {Object} BshopifyExtensionLifecycle
 * @property {(ctx: BshopifyExtensionContext) => BshopifyExtensionPlanResult | Promise<BshopifyExtensionPlanResult>} prepare
 * @property {(ctx: BshopifyExtensionContext, plan: BshopifyPreparedExtensionPlan, plans: BshopifyPreparedExtensionPlan[]) => void | Promise<void>} [validate]
 * @property {(ctx: BshopifyExtensionContext, plan: BshopifyPreparedExtensionPlan, plans: BshopifyPreparedExtensionPlan[]) => void | Promise<void>} [beforeDeploy]
 * @property {(ctx: BshopifyExtensionContext, result: BshopifyExtensionDeployResult) => void | Promise<void>} [afterDeploy]
 * @property {(ctx: BshopifyExtensionContext, error: *) => void | Promise<void>} [onError]
 */

/** @type {BshopifyExtensionLifecycle} */
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
