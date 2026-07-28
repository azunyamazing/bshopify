import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { formatInitResult, initProject } from "../src";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

interface FixturePackageJson {
  scripts: Record<string, string>;
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
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toContain(
      ".bshopify-tmp/",
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
    expect(result.skipped).toContain(".git/hooks/pre-commit");
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
});
