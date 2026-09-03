import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { clearProject, formatClearResult, initProject } from "../src";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

async function createTempProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "bshopify-clear-"));
  tempDirs.push(cwd);

  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture-shopify-app",
        scripts: {
          dev: "shopify app dev",
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

async function readGitConfig(cwd: string, name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "config", "--get", name]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("clearProject", () => {
  it("removes every bshopify-generated file after a plain init", async () => {
    const cwd = await createTempProject();
    await initProject({ cwd });

    const result = await clearProject({ cwd, yes: true });

    await expect(stat(join(cwd, "bshopify.config.mjs"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(cwd, ".bshopify"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      stat(join(cwd, "extensions", "theme-extension", "__entry.js")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toBe(
      "node_modules/\n",
    );
    await expect(stat(join(cwd, ".gitattributes"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(cwd, ".git", "hooks", "pre-commit"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readGitConfig(cwd, "filter.bshopify.clean")).toBeUndefined();
    expect(await readGitConfig(cwd, "filter.bshopify.smudge")).toBeUndefined();
    expect(await readGitConfig(cwd, "filter.bshopify.required")).toBeUndefined();

    expect(result.removed).toContain("bshopify.config.mjs");
    expect(result.removed).toContain(".bshopify/");
    expect(result.removed).toContain("extensions/theme-extension/__entry.js");
    expect(result.removed).toContain(".gitattributes");
    expect(result.removed).toContain(".git/hooks/pre-commit");
    expect(result.updated).toContain(".gitignore");
    expect(result.updated).toContain("git config filter.bshopify");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps customized extension entries", async () => {
    const cwd = await createTempProject();
    await initProject({ cwd });
    const entryPath = join(cwd, "extensions", "theme-extension", "__entry.js");
    await writeFile(entryPath, "export default { custom: true };\n");

    const result = await clearProject({ cwd, yes: true });

    await expect(readFile(entryPath, "utf8")).resolves.toBe(
      "export default { custom: true };\n",
    );
    expect(result.warnings).toContain(
      "kept custom extension entry extensions/theme-extension/__entry.js",
    );
    expect(result.removed).not.toContain("extensions/theme-extension/__entry.js");
  });

  it("keeps user pre-commit hook content and removes only the bshopify guard", async () => {
    const cwd = await createTempProject();
    const hookPath = join(cwd, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, "#!/usr/bin/env sh\nexit 0\nnpm test\n");
    await initProject({ cwd });

    const result = await clearProject({ cwd, yes: true });

    const hook = await readFile(hookPath, "utf8");
    expect(hook).toBe("#!/usr/bin/env sh\nexit 0\nnpm test\n");
    expect(result.updated).toContain(".git/hooks/pre-commit");
  });

  it("keeps custom git clean filter values and only unsets bshopify-managed ones", async () => {
    const cwd = await createTempProject();
    await initProject({ cwd });
    await execFileAsync("git", ["config", "filter.bshopify.clean", "custom-cleaner"], {
      cwd,
    });

    const result = await clearProject({ cwd, yes: true });

    expect(await readGitConfig(cwd, "filter.bshopify.clean")).toBe("custom-cleaner");
    expect(await readGitConfig(cwd, "filter.bshopify.smudge")).toBeUndefined();
    expect(result.warnings).toContain(
      "git config filter.bshopify.clean has a custom value; left in place",
    );
  });

  it("refuses to clear while a dev/deploy process holds the prepare lock", async () => {
    const cwd = await createTempProject();
    await initProject({ cwd });
    await mkdir(join(cwd, ".bshopify"), { recursive: true });
    await writeFile(join(cwd, ".bshopify", "extension-prepare.lock"), `${process.pid}\n`);

    const result = await clearProject({ cwd, yes: true });

    expect(result.errors).toContain(
      `bshopify app dev/deploy is already running (pid ${process.pid}); stop it before running bshopify app clear`,
    );
    expect(result.removed).toEqual([]);
    await expect(stat(join(cwd, "bshopify.config.mjs"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".bshopify"))).resolves.toBeTruthy();
  });

  it("restores pending injections before removing the state directory", async () => {
    const cwd = await createTempProject();
    await initProject({ cwd });
    const targetPath = join(
      cwd,
      "extensions",
      "theme-extension",
      "blocks",
      "app-embed.liquid",
    );
    await mkdir(join(cwd, "extensions", "theme-extension", "blocks"), {
      recursive: true,
    });
    const marker = "{% comment %} bshopify-restore:stale {% endcomment %}";
    await writeFile(targetPath, `<div data-api-base="/apps/fixture-dev${marker}"></div>\n`);
    await writeFile(
      join(cwd, ".bshopify", "extension-prepare.transaction.json"),
      `${JSON.stringify({
        files: [
          {
            path: targetPath,
            replacements: [
              {
                marker,
                pattern: "__SHOPIFY_APP_PROXY_BASE__",
                value: "/apps/fixture-dev",
              },
            ],
          },
        ],
      })}\n`,
    );

    const result = await clearProject({ cwd, yes: true });

    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__"></div>\n',
    );
    expect(result.updated).toContain("restored pending bshopify injections");
    await expect(stat(join(cwd, ".bshopify"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("is a no-op on a project that was never initialized", async () => {
    const cwd = await createTempProject();

    const result = await clearProject({ cwd, yes: true });

    expect(result.removed).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toBe(
      "node_modules/\n",
    );
  });

  it("formats a removal summary with colored sections", () => {
    const summary = formatClearResult({
      errors: ["failed to remove git config"],
      removed: ["bshopify.config.mjs", ".bshopify/"],
      updated: [".gitignore"],
      warnings: ["kept custom extension entry extensions/theme-extension/__entry.js"],
    });

    expect(summary).toContain("\u001B[1mbshopify app clear\u001B[22m");
    expect(summary).toContain("\n\n\u001B[1m\u001B[31mRemoved\u001B[39m\u001B[22m");
    expect(summary).toContain("  \u001B[31m-\u001B[39m bshopify.config.mjs");
    expect(summary).toContain("\n\n\u001B[1m\u001B[36mUpdated\u001B[39m\u001B[22m");
    expect(summary).toContain("  \u001B[36m~\u001B[39m .gitignore");
    expect(summary).toContain(
      "  \u001B[33m!\u001B[39m kept custom extension entry extensions/theme-extension/__entry.js",
    );
    expect(summary).toContain("\n\n\u001B[1m\u001B[31mErrors\u001B[39m\u001B[22m");
    expect(summary).toContain("  \u001B[31mx\u001B[39m failed to remove git config");
  });

  it("formats an empty summary with a no-files note", () => {
    const summary = formatClearResult({
      errors: [],
      removed: [],
      updated: [],
      warnings: [],
    });

    expect(summary).toContain("\u001B[1mbshopify app clear\u001B[22m");
    expect(summary).toContain("\u001B[90mno bshopify-generated files found\u001B[39m");
    expect(summary).not.toContain("Removed");
    expect(summary).not.toContain("Updated");
  });
});
