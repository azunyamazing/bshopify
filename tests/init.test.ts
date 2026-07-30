import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { formatInitResult, initProject } from "../src";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

interface FixturePackageJson {
  scripts: Record<string, string>;
}

interface FixtureInitManifest {
  extensionEntries: Record<string, { contentHash?: string; path: string }>;
  packageScripts: Record<string, string>;
  preCommitHook?: { path: string };
  version: number;
}

async function createTempProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "bshopify-init-"));
  tempDirs.push(cwd);

  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture-shopify-app",
        scripts: {
          dev: "shopify app dev",
          lint: "eslint .",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(cwd, "shopify.app.dev.toml"), "name = \"dev\"\n");
  await writeFile(join(cwd, "shopify.app.test.toml"), "name = \"test\"\n");
  await writeFile(
    join(cwd, "shopify.app.production.toml"),
    "name = \"production\"\n",
  );
  await writeFile(join(cwd, ".gitignore"), "node_modules/\n");
  await mkdir(join(cwd, "extensions", "theme-extension"), { recursive: true });
  await execFileAsync("git", ["init"], { cwd });

  return cwd;
}

async function createLinkedWorktreeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bshopify-worktree-"));
  tempDirs.push(root);

  const repo = join(root, "repo");
  const worktree = join(root, "worktree");
  await mkdir(repo);
  await writeFile(join(repo, "package.json"), `${JSON.stringify({ scripts: {} })}\n`);
  await execFileAsync("git", ["init"], { cwd: repo });
  await execFileAsync("git", ["add", "package.json"], { cwd: repo });
  await execFileAsync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "init"],
    { cwd: repo },
  );
  await execFileAsync("git", ["worktree", "add", worktree], { cwd: repo });

  await writeFile(join(worktree, "shopify.app.dev.toml"), "name = \"dev\"\n");
  await writeFile(join(worktree, "shopify.app.test.toml"), "name = \"test\"\n");
  await writeFile(
    join(worktree, "shopify.app.production.toml"),
    "name = \"production\"\n",
  );
  await writeFile(join(worktree, ".gitignore"), "node_modules/\n");
  await mkdir(join(worktree, "extensions", "theme-extension"), { recursive: true });

  return worktree;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("initProject", () => {
  it("generates runner config, default git hook, gitignore entry, extension entry, and scripts", async () => {
    const cwd = await createTempProject();

    const result = await initProject({ cwd });

    const runnerConfig = await readFile(join(cwd, "bshopify.config.mjs"), "utf8");
    expect(runnerConfig).toContain("// bshopify runner config");
    expect(runnerConfig).toContain("// Shopify app config files by environment.");
    expect(runnerConfig).toContain("extensionsRoot");
    expect(runnerConfig).toContain("restoreMarkers: true");
    expect(runnerConfig).not.toContain("tmpRoot");
    expect(runnerConfig).not.toContain("hideEntryBeforeDeploy");
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toContain(
      ".bshopify/",
    );
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toContain(
      "# bshopify cli",
    );
    await expect(readFile(join(cwd, ".git", "hooks", "pre-commit"), "utf8")).resolves.toContain(
      "./node_modules/.bin/bshopify app guard",
    );
    await expect(
      readFile(join(cwd, "extensions", "theme-extension", "__entry.js"), "utf8"),
    ).resolves.toContain("async prepare(ctx)");

    const packageJson = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8"),
    ) as FixturePackageJson;
    expect(packageJson.scripts.dev).toBe("bshopify app dev");
    expect(packageJson.scripts.deploy).toBe("bshopify app deploy");
    expect(packageJson.scripts.lint).toBe("eslint .");
    expect(packageJson.scripts["shopify:dev"]).toBeUndefined();
    expect(packageJson.scripts["shopify:deploy"]).toBeUndefined();
    expect(packageJson.scripts["shopify:validate"]).toBeUndefined();
    expect(packageJson.scripts["shopify:guard"]).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.created).toContain("bshopify.config.mjs");
    expect(result.updated).toContain(
      'package.json scripts: replaced dev: "shopify app dev" -> "bshopify app dev"',
    );
    expect(result.updated).toContain("package.json scripts: added deploy");
  });

  it("writes an init manifest for generated and managed resources", async () => {
    const cwd = await createTempProject();

    await initProject({ cwd });

    const manifest = JSON.parse(
      await readFile(join(cwd, ".bshopify", "bshopify.manifest.json"), "utf8"),
    ) as FixtureInitManifest;
    await expect(stat(join(cwd, "bshopify.manifest.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(manifest.version).toBe(1);
    expect(manifest).not.toHaveProperty("tmpRoot");
    expect(manifest.packageScripts.dev).toBe("bshopify app dev");
    expect(manifest.packageScripts.deploy).toBe("bshopify app deploy");
    expect(manifest.preCommitHook?.path).toBe(".git/hooks/pre-commit");
    expect(manifest.extensionEntries["theme-extension"]?.path).toBe(
      "extensions/theme-extension/__entry.js",
    );
  });

  it("inserts guard block near the top of an existing pre-commit hook", async () => {
    const cwd = await createTempProject();
    const hookPath = join(cwd, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, "#!/usr/bin/env sh\nexit 0\nnpm test\n");

    const result = await initProject({ cwd });
    const hook = await readFile(hookPath, "utf8");

    expect(hook).toContain("# bshopify app guard start");
    expect(hook.indexOf("bshopify app guard")).toBeLessThan(hook.indexOf("exit 0"));
    expect(hook).toContain("# bshopify app guard end");
    expect(hook).toContain("exit 0");
    expect(hook).toContain("npm test");
    expect(result.updated).toContain(".git/hooks/pre-commit");
  });

  it("does not insert duplicate guard blocks", async () => {
    const cwd = await createTempProject();
    const hookPath = join(cwd, ".git", "hooks", "pre-commit");
    await writeFile(
      hookPath,
      "#!/usr/bin/env sh\n# bshopify app guard start\nbshopify app guard\n# bshopify app guard end\nnpm test\n",
    );

    const result = await initProject({ cwd });
    const hook = await readFile(hookPath, "utf8");

    expect(hook.match(/# bshopify app guard start/g)).toHaveLength(1);
    expect(result.updated).toContain(".git/hooks/pre-commit");
  });

  it("updates existing app guard blocks to the latest managed content", async () => {
    const cwd = await createTempProject();
    const hookPath = join(cwd, ".git", "hooks", "pre-commit");
    await writeFile(
      hookPath,
      "#!/usr/bin/env sh\n# bshopify app guard start\nbshopify app guard\n# bshopify app guard end\nnpm test\n",
    );

    const result = await initProject({ cwd, update: true });
    const hook = await readFile(hookPath, "utf8");

    expect(hook).toContain("./node_modules/.bin/bshopify app guard");
    expect(hook).toContain("npm test");
    expect(hook.match(/# bshopify app guard start/g)).toHaveLength(1);
    expect(result.updated).toContain(".git/hooks/pre-commit");
  });

  it("upgrades legacy bare guard commands into an app guard block", async () => {
    const cwd = await createTempProject();
    const hookPath = join(cwd, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, "#!/usr/bin/env sh\nexit 0\nbshopify guard\n");

    const result = await initProject({ cwd });
    const hook = await readFile(hookPath, "utf8");

    expect(hook).toContain("# bshopify app guard start");
    expect(hook.indexOf("bshopify app guard")).toBeLessThan(hook.indexOf("exit 0"));
    expect(hook.match(/^bshopify guard$/gm)).toBeNull();
    expect(hook).toContain("./node_modules/.bin/bshopify app guard");
    expect(result.updated).toContain(".git/hooks/pre-commit");
  });

  it("upgrades legacy marked guard blocks into an app guard block", async () => {
    const cwd = await createTempProject();
    const hookPath = join(cwd, ".git", "hooks", "pre-commit");
    await writeFile(
      hookPath,
      "#!/usr/bin/env sh\n# bshopify guard start\nbshopify guard\n# bshopify guard end\nnpm test\n",
    );

    const result = await initProject({ cwd });
    const hook = await readFile(hookPath, "utf8");

    expect(hook).toContain("# bshopify app guard start");
    expect(hook).toContain("./node_modules/.bin/bshopify app guard");
    expect(hook).not.toContain("# bshopify guard start");
    expect(hook.match(/^bshopify guard$/gm)).toBeNull();
    expect(result.updated).toContain(".git/hooks/pre-commit");
  });

  it("writes pre-commit hook to the configured core.hooksPath", async () => {
    const cwd = await createTempProject();
    await execFileAsync("git", ["config", "core.hooksPath", ".custom-hooks"], { cwd });

    const result = await initProject({ cwd });

    await expect(readFile(join(cwd, ".custom-hooks", "pre-commit"), "utf8")).resolves.toContain(
      "bshopify app guard",
    );
    expect(result.created).toContain(".custom-hooks/pre-commit");
  });

  it("supports absolute core.hooksPath values", async () => {
    const cwd = await createTempProject();
    const hooksPath = join(cwd, "absolute-hooks");
    await execFileAsync("git", ["config", "core.hooksPath", hooksPath], { cwd });

    const result = await initProject({ cwd });

    await expect(readFile(join(hooksPath, "pre-commit"), "utf8")).resolves.toContain(
      "bshopify app guard",
    );
    expect(result.created).toContain("absolute-hooks/pre-commit");
  });

  it("removes stale managed pre-commit blocks when core.hooksPath changes on update", async () => {
    const cwd = await createTempProject();
    const defaultHookPath = join(cwd, ".git", "hooks", "pre-commit");
    await initProject({ cwd });
    await execFileAsync("git", ["config", "core.hooksPath", ".custom-hooks"], { cwd });

    const result = await initProject({ cwd, update: true });
    const defaultHook = await readFile(defaultHookPath, "utf8");
    const customHook = await readFile(join(cwd, ".custom-hooks", "pre-commit"), "utf8");
    const manifest = JSON.parse(
      await readFile(join(cwd, ".bshopify", "bshopify.manifest.json"), "utf8"),
    ) as FixtureInitManifest;

    expect(defaultHook).not.toContain("# bshopify app guard start");
    expect(customHook).toContain("# bshopify app guard start");
    expect(manifest.preCommitHook?.path).toBe(".custom-hooks/pre-commit");
    expect(result.updated).toContain("removed stale pre-commit guard .git/hooks/pre-commit");
  });

  it("clears stale pre-commit manifest tracking when no git hook path is available", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bshopify-no-git-"));
    tempDirs.push(cwd);
    await writeFile(join(cwd, "package.json"), `${JSON.stringify({ scripts: {} })}\n`);
    await writeFile(join(cwd, "shopify.app.dev.toml"), "name = \"dev\"\n");
    await writeFile(join(cwd, "shopify.app.test.toml"), "name = \"test\"\n");
    await writeFile(join(cwd, "shopify.app.production.toml"), "name = \"production\"\n");
    await writeFile(join(cwd, ".gitignore"), "node_modules/\n");
    await mkdir(join(cwd, "extensions", "theme-extension"), { recursive: true });
    await mkdir(join(cwd, ".bshopify"), { recursive: true });
    await writeFile(
      join(cwd, ".bshopify", "bshopify.manifest.json"),
      `${JSON.stringify(
        {
          configFile: "bshopify.config.mjs",
          extensionEntries: {},
          gitignore: { path: ".gitignore" },
          packageScripts: {},
          preCommitHook: { path: ".git/hooks/pre-commit" },
          version: 1,
        },
        null,
        2,
      )}\n`,
    );

    const result = await initProject({ cwd, update: true });
    const manifest = JSON.parse(
      await readFile(join(cwd, ".bshopify", "bshopify.manifest.json"), "utf8"),
    ) as FixtureInitManifest;

    expect(manifest.preCommitHook).toBeUndefined();
    expect(result.warnings).toContain("git repository not found; pre-commit hook skipped");
  });

  it("creates pre-commit in Git's effective hook path for linked worktrees", async () => {
    const cwd = await createLinkedWorktreeProject();
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", "hooks/pre-commit"], {
      cwd,
    });
    const hookPath = stdout.trim();

    const result = await initProject({ cwd });

    await expect(readFile(hookPath, "utf8")).resolves.toContain("bshopify app guard");
    expect(result.created).toContain(hookPath);
  });

  it("does not overwrite existing extension entries", async () => {
    const cwd = await createTempProject();
    const entryPath = join(cwd, "extensions", "theme-extension", "__entry.js");
    await writeFile(entryPath, "export default { custom: true };\n");

    const result = await initProject({ cwd });

    await expect(readFile(entryPath, "utf8")).resolves.toBe(
      "export default { custom: true };\n",
    );
    expect(result.skipped).toContain("extensions/theme-extension/__entry.js");
  });

  it("syncs entries for extensions added after initialization", async () => {
    const cwd = await createTempProject();
    const existingEntryPath = join(cwd, "extensions", "theme-extension", "__entry.js");
    await initProject({ cwd });
    await writeFile(existingEntryPath, "export default { custom: true };\n");
    await mkdir(join(cwd, "extensions", "new-theme-extension"), { recursive: true });

    const result = await initProject({ cwd, update: true });

    await expect(readFile(existingEntryPath, "utf8")).resolves.toBe(
      "export default { custom: true };\n",
    );
    await expect(
      readFile(join(cwd, "extensions", "new-theme-extension", "__entry.js"), "utf8"),
    ).resolves.toContain("async prepare(ctx)");
    expect(result.created).toContain("extensions/new-theme-extension/__entry.js");
    expect(result.skipped).toContain("extensions/theme-extension/__entry.js");
  });

  it("uses runner config when syncing extension entries", async () => {
    const cwd = await createTempProject();
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry.mjs' };\n",
    );

    const result = await initProject({ cwd, update: true });

    await expect(
      readFile(join(cwd, "extensions", "theme-extension", "entry.mjs"), "utf8"),
    ).resolves.toContain("async prepare(ctx)");
    expect(result.created).toContain("extensions/theme-extension/entry.mjs");
  });

  it("does not claim pre-existing custom extension entries as managed resources", async () => {
    const cwd = await createTempProject();
    const customEntryPath = join(cwd, "extensions", "theme-extension", "__entry.js");
    await writeFile(customEntryPath, "export default { custom: true };\n");
    await initProject({ cwd });
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry.mjs' };\n",
    );

    const result = await initProject({ cwd, update: true });
    const manifest = JSON.parse(
      await readFile(join(cwd, ".bshopify", "bshopify.manifest.json"), "utf8"),
    ) as FixtureInitManifest;

    await expect(readFile(customEntryPath, "utf8")).resolves.toBe(
      "export default { custom: true };\n",
    );
    await expect(
      readFile(join(cwd, "extensions", "theme-extension", "entry.mjs"), "utf8"),
    ).resolves.toContain("async prepare(ctx)");
    expect(manifest.extensionEntries["theme-extension"]?.path).toBe(
      "extensions/theme-extension/entry.mjs",
    );
    expect(result.created).toContain("extensions/theme-extension/entry.mjs");
  });

  it("merges existing runner config with the latest managed defaults and keeps user fields", async () => {
    const cwd = await createTempProject();
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      [
        "export default {",
        '  entryFileName: "entry.mjs",',
        '  customField: "kept",',
        "};",
        "",
      ].join("\n"),
    );

    const result = await initProject({ cwd, update: true });
    const runnerConfig = await readFile(join(cwd, "bshopify.config.mjs"), "utf8");

    expect(runnerConfig).toContain('entryFileName: "entry.mjs"');
    expect(runnerConfig).toContain('extensionsRoot: "extensions"');
    expect(runnerConfig).toContain("configFiles:");
    expect(runnerConfig).toContain("failOnUnresolvedPlaceholders: true");
    expect(runnerConfig).toContain("restoreMarkers: true");
    expect(runnerConfig).not.toContain("hideEntryBeforeDeploy");
    expect(runnerConfig).toContain('customField: "kept"');
    expect(result.updated).toContain("bshopify.config.mjs");
  });

  it("merges missing runner config fields even when nested objects use the same names", async () => {
    const cwd = await createTempProject();
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      [
        "export default {",
        "  custom: {",
        "    configFiles: {},",
        "    restoreMarkers: false,",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    await initProject({ cwd, update: true });
    const runnerConfig = await readFile(join(cwd, "bshopify.config.mjs"), "utf8");

    expect(runnerConfig).toContain("  custom: {");
    expect(runnerConfig).toContain("    restoreMarkers: false,");
    expect(runnerConfig).toContain("\n  configFiles: {");
    expect(runnerConfig).toContain("\n  restoreMarkers: true,");
  });

  it("merges runner config fields after block comments with braces", async () => {
    const cwd = await createTempProject();
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      [
        "export default {",
        "  /* { */",
        '  customField: "kept",',
        "  restoreMarkers: false,",
        "};",
        "",
      ].join("\n"),
    );

    await initProject({ cwd, update: true });
    const runnerConfig = await readFile(join(cwd, "bshopify.config.mjs"), "utf8");

    expect(runnerConfig).toContain('customField: "kept"');
    expect(runnerConfig).toContain("\n  restoreMarkers: false,");
    expect(runnerConfig.match(/restoreMarkers:/g)).toHaveLength(1);
  });

  it("adds missing package scripts on update without replacing custom scripts", async () => {
    const cwd = await createTempProject();
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture-shopify-app",
          scripts: {
            dev: "pnpm custom-dev",
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await initProject({ cwd, update: true });
    const packageJson = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8"),
    ) as FixturePackageJson;

    expect(packageJson.scripts.dev).toBe("pnpm custom-dev");
    expect(packageJson.scripts.deploy).toBe("bshopify app deploy");
    expect(result.updated).toContain("package.json scripts: added deploy");
    expect(result.warnings).toContain(
      'package.json scripts: kept custom dev: "pnpm custom-dev"',
    );
  });

  it("renames stale generated extension entries when the configured entry name changes", async () => {
    const cwd = await createTempProject();
    await initProject({ cwd });
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry.mjs' };\n",
    );

    const result = await initProject({ cwd, update: true });

    await expect(
      stat(join(cwd, "extensions", "theme-extension", "__entry.js")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(cwd, "extensions", "theme-extension", "entry.mjs"), "utf8"),
    ).resolves.toContain("async prepare(ctx)");
    expect(result.updated).toContain(
      "renamed extension entry extensions/theme-extension/__entry.js -> extensions/theme-extension/entry.mjs",
    );
  });

  it("renames stale customized extension entries when the configured entry name changes", async () => {
    const cwd = await createTempProject();
    const staleEntryPath = join(cwd, "extensions", "theme-extension", "__entry.js");
    await initProject({ cwd });
    await writeFile(staleEntryPath, "export default { custom: true };\n");
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry.mjs' };\n",
    );

    const result = await initProject({ cwd, update: true });

    await expect(stat(staleEntryPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(cwd, "extensions", "theme-extension", "entry.mjs"), "utf8"),
    ).resolves.toBe("export default { custom: true };\n");
    expect(result.updated).toContain(
      "renamed extension entry extensions/theme-extension/__entry.js -> extensions/theme-extension/entry.mjs",
    );
  });

  it("renames manifest-tracked extension entries across multiple configured entry names", async () => {
    const cwd = await createTempProject();
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry-a.mjs' };\n",
    );
    await initProject({ cwd });
    await writeFile(
      join(cwd, "extensions", "theme-extension", "entry-a.mjs"),
      "export default { custom: true };\n",
    );
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry-b.mjs' };\n",
    );

    const result = await initProject({ cwd, update: true });

    await expect(
      stat(join(cwd, "extensions", "theme-extension", "entry-a.mjs")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(cwd, "extensions", "theme-extension", "entry-b.mjs"), "utf8"),
    ).resolves.toBe("export default { custom: true };\n");
    expect(result.updated).toContain(
      "renamed extension entry extensions/theme-extension/entry-a.mjs -> extensions/theme-extension/entry-b.mjs",
    );
  });

  it("keeps stale customized extension entries when the configured entry already exists", async () => {
    const cwd = await createTempProject();
    const staleEntryPath = join(cwd, "extensions", "theme-extension", "__entry.js");
    await initProject({ cwd });
    await writeFile(staleEntryPath, "export default { custom: true };\n");
    await writeFile(join(cwd, "extensions", "theme-extension", "entry.mjs"), "export default {};\n");
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry.mjs' };\n",
    );

    const result = await initProject({ cwd, update: true });

    await expect(readFile(staleEntryPath, "utf8")).resolves.toBe(
      "export default { custom: true };\n",
    );
    expect(result.warnings).toContain(
      "custom stale entry left in place: extensions/theme-extension/__entry.js",
    );
  });

  it("does not track a custom target entry when removing a stale generated entry", async () => {
    const cwd = await createTempProject();
    await initProject({ cwd });
    await writeFile(
      join(cwd, "extensions", "theme-extension", "entry.mjs"),
      "export default { custom: true };\n",
    );
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry.mjs' };\n",
    );

    const result = await initProject({ cwd, update: true });
    const manifest = JSON.parse(
      await readFile(join(cwd, ".bshopify", "bshopify.manifest.json"), "utf8"),
    ) as FixtureInitManifest;

    expect(manifest.extensionEntries["theme-extension"]).toBeUndefined();
    expect(result.updated).toContain(
      "removed stale generated entry extensions/theme-extension/__entry.js",
    );
    expect(result.warnings).toContain(
      "custom extension entry left unmanaged: extensions/theme-extension/entry.mjs",
    );
  });

  it("keeps manifest-tracked custom stale entries tracked when the configured entry already exists", async () => {
    const cwd = await createTempProject();
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry-a.mjs' };\n",
    );
    await initProject({ cwd });
    await writeFile(
      join(cwd, "extensions", "theme-extension", "entry-a.mjs"),
      "export default { custom: true };\n",
    );
    await writeFile(
      join(cwd, "extensions", "theme-extension", "entry-b.mjs"),
      "export default { existing: true };\n",
    );
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry-b.mjs' };\n",
    );

    const result = await initProject({ cwd, update: true });
    const manifest = JSON.parse(
      await readFile(join(cwd, ".bshopify", "bshopify.manifest.json"), "utf8"),
    ) as FixtureInitManifest;

    await expect(
      readFile(join(cwd, "extensions", "theme-extension", "entry-a.mjs"), "utf8"),
    ).resolves.toBe("export default { custom: true };\n");
    await expect(
      readFile(join(cwd, "extensions", "theme-extension", "entry-b.mjs"), "utf8"),
    ).resolves.toBe("export default { existing: true };\n");
    expect(result.warnings).toContain(
      "custom stale entry left in place: extensions/theme-extension/entry-a.mjs",
    );
    expect(manifest.extensionEntries["theme-extension"]?.path).toBe(
      "extensions/theme-extension/entry-a.mjs",
    );
  });

  it("does not remove untracked template-like files while cleaning stale entries", async () => {
    const cwd = await createTempProject();
    await initProject({ cwd });
    const generatedEntry = await readFile(
      join(cwd, "extensions", "theme-extension", "__entry.js"),
      "utf8",
    );
    const untrackedTemplateLikeFile = join(
      cwd,
      "extensions",
      "theme-extension",
      "notes.js",
    );
    await writeFile(untrackedTemplateLikeFile, generatedEntry);
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry.mjs' };\n",
    );

    await initProject({ cwd, update: true });

    await expect(readFile(untrackedTemplateLikeFile, "utf8")).resolves.toBe(
      generatedEntry,
    );
  });

  it("updates manifest-tracked generated extension entries to the latest template", async () => {
    const cwd = await createTempProject();
    const entryPath = join(cwd, "extensions", "theme-extension", "__entry.js");
    await initProject({ cwd });
    const manifest = JSON.parse(
      await readFile(join(cwd, ".bshopify", "bshopify.manifest.json"), "utf8"),
    ) as FixtureInitManifest;
    const oldGeneratedEntry = "export default { async prepare() { return { injections: [] }; } };\n";
    const oldGeneratedHash = createHash("sha256").update(oldGeneratedEntry).digest("hex");
    await writeFile(entryPath, oldGeneratedEntry);
    await writeFile(
      join(cwd, ".bshopify", "bshopify.manifest.json"),
      `${JSON.stringify(
        {
          ...manifest,
          extensionEntries: {
            "theme-extension": {
              contentHash: oldGeneratedHash,
              path: "extensions/theme-extension/__entry.js",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await initProject({ cwd, update: true });

    await expect(readFile(entryPath, "utf8")).resolves.toContain("async beforeDeploy(ctx, plan, plans)");
    expect(result.updated).toContain(
      "updated generated extension entry extensions/theme-extension/__entry.js",
    );
  });

  it("ignores manifest entry paths outside the extension directory", async () => {
    const cwd = await createTempProject();
    const outsideDir = await mkdtemp(join(tmpdir(), "bshopify-outside-"));
    tempDirs.push(outsideDir);
    const outsideEntry = join(outsideDir, "entry.js");
    await initProject({ cwd });
    await writeFile(outsideEntry, "export default { outside: true };\n");
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { entryFileName: 'entry.mjs' };\n",
    );
    await writeFile(
      join(cwd, ".bshopify", "bshopify.manifest.json"),
      `${JSON.stringify(
        {
          configFile: "bshopify.config.mjs",
          extensionEntries: {
            "theme-extension": {
              path: relative(cwd, outsideEntry),
            },
          },
          gitignore: { path: ".gitignore" },
          packageScripts: {},
          version: 1,
        },
        null,
        2,
      )}\n`,
    );

    const result = await initProject({ cwd, update: true });

    await expect(readFile(outsideEntry, "utf8")).resolves.toBe(
      "export default { outside: true };\n",
    );
    await expect(
      readFile(join(cwd, "extensions", "theme-extension", "entry.mjs"), "utf8"),
    ).resolves.toContain("async prepare(ctx)");
    expect(result.warnings).toContain(
      `ignored manifest entry outside extension directory: ${relative(cwd, outsideEntry)}`,
    );
  });

  it("prunes manifest entries for extensions that no longer exist on update", async () => {
    const cwd = await createTempProject();
    await mkdir(join(cwd, "extensions", "removed-extension"), { recursive: true });
    await initProject({ cwd });
    await rm(join(cwd, "extensions", "removed-extension"), { recursive: true });

    const result = await initProject({ cwd, update: true });
    const manifest = JSON.parse(
      await readFile(join(cwd, ".bshopify", "bshopify.manifest.json"), "utf8"),
    ) as FixtureInitManifest;

    expect(manifest.extensionEntries["removed-extension"]).toBeUndefined();
    expect(result.updated).toContain(
      "removed stale manifest entry extensions/removed-extension",
    );
  });

  it("checks project readiness without writing files", async () => {
    const cwd = await createTempProject();

    const result = await initProject({ cwd, check: true });

    await expect(stat(join(cwd, "bshopify.config.mjs"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(result.checks).toContainEqual({
      name: "package.json",
      ok: true,
      message: "found package.json",
    });
    expect(result.errors).toEqual([]);
  });

  it("reports invalid config file paths during check instead of throwing", async () => {
    const cwd = await createTempProject();
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      [
        "export default {",
        "  configFiles: {",
        '    dev: "configs/shopify.app.preview.toml",',
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const result = await initProject({ cwd, check: true });

    expect(result.checks).toContainEqual({
      name: "bshopify.config.mjs",
      ok: false,
      message: "invalid bshopify.config.mjs",
    });
    expect(result.errors).toContain(
      "bshopify configFiles.dev must be a root-level Shopify app config file: shopify.app.toml or shopify.app.<name>.toml.",
    );
  });

  it("formats init summary with colored sections", () => {
    const summary = formatInitResult({
      checks: [{ name: "package.json", ok: true, message: "found package.json" }],
      created: ["bshopify.config.mjs"],
      errors: ["missing extensions"],
      skipped: ["extensions/theme-extension/__entry.js"],
      updated: ["package.json scripts: added deploy"],
      warnings: ["git repository not found; pre-commit hook skipped"],
    });

    expect(summary).toContain("\n\n\u001B[1m\u001B[34mChecks\u001B[39m\u001B[22m");
    expect(summary).toContain("  \u001B[32mok\u001B[39m package.json");
    expect(summary).not.toContain("package.json: package.json");
    expect(summary).not.toContain("found package.json");
    expect(summary).toContain("\n\n\u001B[1m\u001B[36mUpdated\u001B[39m\u001B[22m");
    expect(summary).toContain("  \u001B[36m~\u001B[39m package.json scripts: added deploy");
    expect(summary).toContain("  \u001B[33m!\u001B[39m git repository not found; pre-commit hook skipped");
    expect(summary).toContain("  \u001B[31mx\u001B[39m missing extensions");
  });

  it("formats update summaries with a local changes block", () => {
    const summary = formatInitResult({
      checks: [{ name: "package.json", ok: true, message: "found package.json" }],
      created: ["extensions/new-extension/__entry.js"],
      errors: [],
      mode: "update",
      skipped: [],
      updated: [".gitignore"],
      warnings: ["custom stale entry left in place: extensions/theme-extension/__entry.js"],
    });

    expect(summary).toContain("\u001B[1mbshopify app init --update\u001B[22m");
    expect(summary).toContain("\n\n\u001B[1m\u001B[36mLocal changes\u001B[39m\u001B[22m\n\n");
    expect(summary).toContain(
      "  \u001B[32m+\u001B[39m created extensions/new-extension/__entry.js",
    );
    expect(summary).toContain("  \u001B[36m~\u001B[39m updated .gitignore");
    expect(summary).toContain(
      "  \u001B[33m!\u001B[39m warning custom stale entry left in place: extensions/theme-extension/__entry.js",
    );
    expect(summary).not.toContain("\u001B[1m\u001B[32mCreated\u001B[39m\u001B[22m");
    expect(summary).not.toContain("\u001B[1m\u001B[36mUpdated\u001B[39m\u001B[22m");
    expect(summary).not.toContain("\u001B[1m\u001B[33mWarnings\u001B[39m\u001B[22m");
  });

  it("formats update summaries when there are no local changes", () => {
    const summary = formatInitResult({
      checks: [{ name: "package.json", ok: true, message: "found package.json" }],
      created: [],
      errors: [],
      mode: "update",
      skipped: ["package.json scripts"],
      updated: [],
      warnings: [],
    });

    expect(summary).toContain("\n\n\u001B[1m\u001B[36mLocal changes\u001B[39m\u001B[22m\n\n");
    expect(summary).toContain("  \u001B[90m-\u001B[39m no local changes");
  });
});
