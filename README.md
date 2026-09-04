# @standhigher/bshopify

> BestFulfill Shopify App Runner CLI · a unified entrypoint for `shopify app xx`, orchestrating injection, restoration, validation, and commit protection around the real Shopify CLI

**English** | [中文](./README.zh-CN.md)

## Introduction

`@standhigher/bshopify` is the Shopify App Runner CLI built by the BestFulfill team. It standardizes the `shopify app xx` entrypoint across team projects, orchestrating Extension Entry lifecycle, config injection, runtime restoration, validation, and commit protection around the real Shopify CLI — so multi-environment config injection and secret safety become reusable engineering, not per-project shell scripts.

Owned command surface today: `app init` (project bootstrap), `app dev` (development injection), `app deploy` (deployment injection), `app guard` (commit protection), and `app clear` (rollback). Commands bshopify does not own fall through to your local `shopify` CLI with the original arguments, so existing workflows keep working.

## Highlights

- **One-command bootstrap**: `bshopify app init` generates the config file, Extension Entries, and Git hooks / filters. Idempotent and safe to re-run.
- **Per-environment config injection**: during `dev` / `deploy`, bshopify temporarily injects real values into target files according to `bshopify.config.mjs` and restores placeholders when the command finishes.
- **Secrets never land in Git**: a Git clean filter plus a pre-commit guard provide a double safety net — injected values or held locks cannot be committed.
- **Fallback compatible**: commands bshopify does not own are passed through to the Shopify CLI untouched; taking over a new command only adds behavior.

## Requirements

- Node.js >= 22.12.0
- npm
- Shopify CLI: owned commands invoke it via `execa`, preferring the project-local `node_modules/.bin/shopify` and falling back to `shopify` on your PATH

## Install

Install as a local dependency inside a Shopify app project (recommended), or globally:

```bash
# Inside the project (recommended; a devDependency is enough)
npm install -D @standhigher/bshopify

# Or globally
npm install -g @standhigher/bshopify
```

A global install is enough for full editor type hints on the generated
`bshopify.config.mjs`: the template `init` writes is self-contained JSDoc
(no package import), so it type-checks in any project regardless of install
mode (see [Configuring `bshopify.config.mjs`](#configuring-bshopifyconfigmjs)).

## Quick start

Run the bootstrap from the root of a Shopify app project:

```bash
bshopify app init
```

`init` checks the project and generates whatever is missing:

- `bshopify.config.mjs` — runner config (only the fields your team needs, with self-contained JSDoc type hints that work whether the package is installed locally or used globally)
- `.gitignore` — appends a `# bshopify cli` block and `.bshopify/`
- `pre-commit` in your Git hooks directory (a marked `bshopify app guard` block)
- `extensions/*/__entry.js` — extension lifecycle entrypoints (with `// @ts-check` and self-contained JSDoc type hints, no package import)
- `.bshopify/git-add-cleaner.js` + `.gitattributes` + Git local config `filter.bshopify.*` — clean/smudge filter (the script lives under the ignored `.bshopify/`, so it is not committed)

`init` **never rewrites `package.json`**; scripts are yours to maintain. Wire it up:

```json
{
  "scripts": {
    "dev": "bshopify app dev",
    "deploy": "bshopify app deploy"
  }
}
```

Then develop as usual:

```bash
npm run dev
```

During `dev`, Git restores injected values to placeholders before staging, so real URLs / secrets never reach a commit.

## CLI commands

### Overview

| Command | Purpose | Notes |
|-|-|-|
| `bshopify app init` | Bootstrap bshopify into the project | `--check` is read-only; `--cwd <path>` targets a directory; idempotent |
| `bshopify app dev` | Inject extension config, then run `shopify app dev` | `--config <key>` selects a `configFiles` environment |
| `bshopify app deploy` | Inject extension config, then run `shopify app deploy` | `--config`, `--dry-run`, `--yes`, `--confirm-production` |
| `bshopify app guard` | Block real injected values or held locks from being committed | Invoked automatically by the pre-commit hook |
| `bshopify app clear` | Remove everything bshopify generated; restore the pre-bootstrap state | `--yes` skips confirmation; never deletes your code |
| Any other command | Falls through to the local Shopify CLI | e.g. `bshopify theme dev` → `shopify theme dev` |

### Fallback behavior

Commands bshopify does not own (e.g. the `theme` domain, or `app` subcommands not yet taken over) are executed against the Shopify CLI with the original arguments. When bshopify takes over a command later, it layers injection, validation, and restoration on top of the existing Shopify command format.

### app init

```bash
bshopify app init              # bootstrap in the project root
bshopify app init --check      # read-only check, writes nothing
bshopify app init --cwd ./path/to/shopify-app
```

Behavior notes:

- **Idempotent**: re-running only fills in missing managed files and refreshes the manifest. Existing content gets safe incremental updates — the pre-commit guard block is refreshed to the current template, and clean filter scripts carrying the generated marker are replaced with the latest template; **generated entries are never overwritten**, so your custom logic survives.
- **Missing TOML does not abort**: when a TOML targeted by `configFiles` is missing, any existing `shopify.app*.toml` is reused for every environment; if none exists, `shopify app config link` is invoked once to create a default `shopify.app.toml`, and dev / test / production all point at it. `--check` is read-only and never triggers generation.
- **Upgrading bshopify**: there is no automatic migration command. After an upgrade, re-running `init` refreshes the guard block and older clean filter scripts automatically; other managed files (entry templates, manifest coordinates, etc.) do not auto-migrate — follow the CHANGELOG / migration guide, and when needed delete the old generated files and re-run `init`.

### app dev

```bash
bshopify app dev                 # uses configFiles.dev by default
bshopify app dev --config test   # switch to the test environment
```

By default bshopify injects into the TOML that `configFiles.dev` points at and runs `shopify app dev`. With `--config <key>`, it reads the TOML for that key and derives the config name passed to the Shopify CLI from the file name — e.g. `configFiles.test = "shopify.app.preview.toml"` runs `shopify app dev --config preview`; when the path is the default `shopify.app.toml`, no `--config` is passed.

`dev` only restores the values injected in the current run. If the process is killed, the next run detects the stale lock and restores from the leftover journal automatically — injected values never stay in your working tree.

### app deploy

```bash
bshopify app deploy                       # pick a deploy environment from configFiles interactively
bshopify app deploy --config production   # deploy production directly
bshopify app deploy --config production --dry-run   # prepare and validate injections without calling the Shopify CLI
bshopify app deploy --confirm-production  # non-interactive production deploy (CI)
bshopify app deploy --yes                 # skip the final deploy confirmation (production still needs --confirm-production)
```

`deploy` shares the injection pipeline with `dev`: it picks a TOML from `configFiles`, injects real values, validates that all placeholders resolved, then calls the Shopify CLI; afterwards it restores the injections and releases the lock. Without `--config`, it asks you to pick an environment interactively (`configFiles` must define at least one target). Selecting `production` requires typing `confirm`; `--confirm-production` or `--dry-run` bypass that check (`--yes` does not). `--dry-run` is meant for CI / preflight and never triggers a real deploy.

### app guard

Usually invoked automatically by the pre-commit hook; can also be run manually:

```bash
bshopify app guard
```

guard refuses the commit when staged content still contains unrestored real injected values, or when the dev / deploy prepare lock is still held (an injection session is running). It passes silently when there is no risk.

### app clear

```bash
bshopify app clear        # restore after interactive confirmation
bshopify app clear --yes  # skip confirmation
bshopify app clear --cwd ./path/to/shopify-app
```

`clear` is the inverse of `init`: it deletes everything bshopify generated and reverts the files it modified — `.bshopify/`, `bshopify.config.mjs`, entries that are still generated templates, the `# bshopify cli` blocks appended to `.gitignore` / `.gitattributes`, the guard block in pre-commit, and the local `filter.bshopify.*` git config. **It never deletes your code**: entries you customized are kept and reported; if `dev` / `deploy` is running (lock held) it refuses to proceed.

## Configuring `bshopify.config.mjs`

Generated by `init`, organized into app / extension sections. The generated file ships with self-contained type hints: a leading `// @ts-check` plus an inline JSDoc `@typedef` that types the default export — no package import at all — so editing fields gives autocomplete and error reporting whether bshopify is installed in this project or only available as a global install:

```js
// @ts-check
/**
 * bshopify runner config.
 *
 * @typedef {Object} BshopifyRunnerConfig
 * @property {Record<string, string>} [configFiles] Shopify app config files by environment (key → root-relative `shopify.app*.toml`).
 * @property {Record<string, string | string[]>} [envFiles] Custom env namespaces injected into the extension entry context (key → one or more root-relative JSON/TOML file paths).
 * @property {boolean} [failOnUnresolvedPlaceholders] Fail when an injection plan leaves template placeholders unresolved.
 */

/** @type {BshopifyRunnerConfig} */
export default {
  // --- App: Shopify app config files by environment ---
  configFiles: {
    dev: "shopify.app.dev.toml",
    test: "shopify.app.test.toml",
    production: "shopify.app.production.toml",
  },

  // --- Extension: custom env injection (optional) ---
  // envFiles: {
  //   aEnv: ["config/a.json", "config/a.toml"],
  //   bEnv: "config/b.json",
  // },

  // --- Extension: injection behavior ---
  failOnUnresolvedPlaceholders: true,
};
```

### Field reference

- **`configFiles`** (app level): maps an environment name to a root-level Shopify app TOML. `--config <name>` on `dev` / `deploy` selects by this key. File names must follow Shopify CLI naming rules (`shopify.app.toml` or `shopify.app.<name>.toml`).
- **`envFiles`** (extension level, optional): namespaces for custom env injection — key → one or more JSON/TOML files relative to the project root. Each key becomes an independent field on the ctx injected into `__entry` (e.g. `aEnv` → `ctx.aEnv`); multiple files are shallow-merged in order, later files overriding same-name keys; file contents must be JSON/TOML objects. Keys must be valid JS identifiers and must not collide with `configPath` / `env` / `appConfig`; paths must stay inside the project root (no absolute paths or `../` escapes). A missing file only warns and is skipped without aborting; unsupported formats, parse failures, or non-object contents error out.
- **`failOnUnresolvedPlaceholders`** (extension level): whether to fail when template placeholders remain in target files after injection.

`extensionsRoot`, `entryFileName`, and `restoreMarkers` are internal defaults (`extensions`, `__entry.js`, `true`) and are no longer written into new config files; existing configs may still override them for backward compatibility. `init` only merges missing fields into an existing config (fills in `configFiles` and `failOnUnresolvedPlaceholders`) and never overrides user fields, including `envFiles`.

Prefer a Vite-style config? Wrap the default export with `defineConfig` (an identity helper exported by the package, purely for type checking and hints):

```js
// @ts-check
import { defineConfig } from "@standhigher/bshopify";

export default defineConfig({
  restoreMarkers: false,
});
```

> Note: the `defineConfig` form requires the project to be able to `import` `@standhigher/bshopify`, so it only makes sense when the package is installed in the project. The template `init` generates uses the self-contained JSDoc form above instead, which works with no install at all.

## Writing an Extension Entry (`__entry.js`)

The `extensions/*/__entry.js` generated by `init` is the extension lifecycle entrypoint, typed out of the box. Like the runner config, the template is self-contained JSDoc — inline typedefs, no package import — so it type-checks whether bshopify is installed in this project or only available globally:

```js
// @ts-check
/** @type {BshopifyExtensionLifecycle} */
export default {
  async prepare(ctx) {
    return { injections: [ /* ... */ ] };
  },
  // validate / beforeDeploy / afterDeploy / onError share the same type inference
};
```

The typedefs (`BshopifyExtensionLifecycle`, `BshopifyExtensionContext`, `BshopifyInjectionPlan`, `BshopifyExtensionPlanResult`, `BshopifyExtensionDeployResult`, `BshopifyPreparedExtensionPlan`) are emitted at the top of the generated file; `ctx` (`configPath` / `env` / `appConfig`), `plan`, `plans`, `result` and `error` all get autocomplete and error reporting in the editor. When the package is installed in the project, the same hooks can instead be typed against the package's exported `ExtensionLifecycle` / `ExtensionContext` types for the full (deeper) shapes.

**Placeholder entries are skipped automatically**: when an `__entry.js` is still the untouched generated template (no injections or hook logic), `dev` / `deploy` skips it entirely — not loaded, not executed, not injected, not listed in the summary, with a single `Skipped N placeholder extension entries ...` line. Once you edit the template (e.g. add an injection), it is no longer a placeholder and returns to the execution path, avoiding useless imports and output noise in multi-extension projects.

## Safety & recovery internals

- **Restore markers**: after injecting, `dev` / `deploy` appends a self-describing marker per target file type (placeholder + injected value length + checksum + random token; never the value itself), choosing comment syntax compatible with the file (js/css `/* */`, html `<!-- -->`, liquid `{% comment %}`, toml trailing `#`), so files like `shopify.app*.toml` stay valid TOML. The marker drives both the Git clean filter and crash recovery; the checksum ensures only markers bshopify actually wrote are trusted, so lookalike text or hand-edited values are never wrongly restored.
- **Git clean filter**: real values injected during `dev` are restored to placeholders by `.bshopify/git-add-cleaner.js` before staging on `git add`. The filter is configured in the local `.git/config`, with the script under the ignored `.bshopify/` — a fresh clone must run `init` for the filter to work. Scripts carry a generated marker: re-running `init` replaces older generated scripts with the latest template and leaves unmarked custom scripts untouched. Files without markers (including binaries) pass through as-is; machines without the filter stage files as-is silently (`required` defaults to `false`).
- **Pre-commit guard**: `init` inserts a marked `bshopify app guard` block into pre-commit. If a `pre-commit` already exists, the block is inserted after the shebang without overwriting the original content; the hook prefers the project-local `./node_modules/.bin/bshopify` and falls back to PATH. It writes to `core.hooksPath` when configured, otherwise to `.git/hooks/pre-commit`.

If you hit an incompatible file type or comment syntax, disable markers explicitly in the config (`restoreMarkers: false`). Without markers, `dev` still restores at exit by matching injected values, but hand-written duplicate values written during `dev` may also be restored, and the Git clean filter can no longer restore injected files.

## FAQ

- **pre-commit not firing?** Make sure the project ran `bshopify app init` (the filter and hook live in the local Git config; a fresh clone must run it again).
- **`config.mjs` shows `Cannot find module '@standhigher/bshopify' or its corresponding type declarations` in the editor?** Your config file uses an import-based hint form (`@type {import('@standhigher/bshopify')...}` or `defineConfig`) but the package is not installed in this project — TypeScript never resolves globally installed packages. Regenerate the config with `bshopify app init` (it now emits a self-contained JSDoc typedef that needs no install), or install the package locally (`npm install -D @standhigher/bshopify`).
- **`defineConfig` fails to import?** The project has not installed `@standhigher/bshopify` (global only) — use the self-contained JSDoc form that `init` generates.
- **Entry edited but `dev` does not inject?** Make sure the entry is no longer the placeholder template — template files are skipped; once changed (any injection added) it returns to the execution path.

## Local development (this repo)

```bash
npm install
npm run dev -- --help    # run the CLI directly via tsx
npm run typecheck        # TypeScript type checking
npm run test             # Vitest tests
npm run build            # build to dist/ with tsup
npm run check            # typecheck + test + build + dist smoke test
```

Local link debugging (only needed when you want the package importable in a
consumer project, e.g. to use `defineConfig` while developing):

```bash
npm run build && npm link                       # in the bshopify repo
npm link @standhigher/bshopify                  # in the target Shopify app project
bshopify app init --check                       # verify
npm unlink @standhigher/bshopify                # undo
```

The config template `init` generates does not need any of this — it is
self-contained JSDoc and type-checks without the package being installed.

Pre-publish verification:

```bash
npm run check
npm pack --dry-run   # confirm the published contents (files: ["dist"]) are as expected
```
