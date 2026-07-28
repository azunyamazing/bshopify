export const configFileName = "bshopify.config.mjs";
export const entryFileName = "__entry.js";
export const tmpRoot = ".bshopify-tmp/";

export const requiredShopifyConfigFiles = [
  "shopify.app.dev.toml",
  "shopify.app.test.toml",
  "shopify.app.production.toml",
];

export const recommendedScripts: Record<string, string> = {
  dev: "bshopify app dev",
  deploy: "bshopify app deploy",
};

export const runnerConfigTemplate = `// bshopify runner config
// This file controls how bshopify discovers Shopify extensions and config files.
export default {
  // Directory that contains Shopify extension folders.
  extensionsRoot: "extensions",

  // Temporary transaction directory used while injecting and restoring files.
  tmpRoot: ".bshopify-tmp",

  // Business-side extension entry file generated under each extension.
  entryFileName: "__entry.js",

  // Shopify app config files by environment.
  configFiles: {
    dev: "shopify.app.dev.toml",
    test: "shopify.app.test.toml",
    production: "shopify.app.production.toml",
  },

  // Fail when an injection plan leaves template placeholders unresolved.
  failOnUnresolvedPlaceholders: true,

  // Add file-type-aware restore comments during dev so cleanup only reverts injected values.
  // Set to false as an escape hatch if a target file type cannot safely contain comments.
  restoreMarkers: true,

  // Hide extension entry files before deploy so they are not shipped.
  hideEntryBeforeDeploy: true,
};
`;

export const extensionEntryTemplate = `export default {
  async prepare(ctx) {
    return {
      extension: ctx.extension.name,
      injections: [
        // {
        //   file: "blocks/app-embed.liquid",
        //   strategy: "replace",
        //   pattern: "__SHOPIFY_APP_PROXY_BASE__",
        //   value: ctx.extensionEnv.SHOPIFY_APP_PROXY_BASE,
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

export const legacyPreCommitGuardCommand = "bshopify guard";
export const legacyPreCommitGuardEndMarker = "# bshopify guard end";
export const legacyPreCommitGuardStartMarker = "# bshopify guard start";
export const preCommitGuardCommand = `if [ -x "./node_modules/.bin/bshopify" ]; then
  ./node_modules/.bin/bshopify app guard
else
  bshopify app guard
fi`;
export const preCommitGuardEndMarker = "# bshopify app guard end";
export const preCommitGuardStartMarker = "# bshopify app guard start";

export const preCommitHookTemplate = `#!/usr/bin/env sh
set -e

${preCommitGuardStartMarker}
${preCommitGuardCommand}
${preCommitGuardEndMarker}
`;
