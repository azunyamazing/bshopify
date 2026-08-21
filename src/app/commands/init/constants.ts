export const configFileName = "bshopify.config.mjs";

export const recommendedScripts: Record<string, string> = {
  dev: "bshopify app dev",
  deploy: "bshopify app deploy",
};

export const runnerConfigTemplate = `// bshopify runner config
// This file controls how bshopify selects Shopify app config files and how
// extension injections behave during dev and deploy.

export default {
  // --- App: Shopify app config files by environment ---
  configFiles: {
    dev: "shopify.app.dev.toml",
    test: "shopify.app.test.toml",
    production: "shopify.app.production.toml",
  },

  // --- Extension: injection behavior ---
  // Fail when an injection plan leaves template placeholders unresolved.
  failOnUnresolvedPlaceholders: true,
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
