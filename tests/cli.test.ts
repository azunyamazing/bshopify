import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppCommand } from "../src/commands/app";
import {
  createCliProgram,
  devProject,
  packageInfo,
  runShopifyCommand,
  runCli,
} from "../src";

interface CommandWithRuntimeHiddenFlag {
  _hidden?: boolean;
}

const tempDirs: string[] = [];

function createEmptyInitResult() {
  return {
    checks: [],
    created: [],
    errors: [],
    skipped: [],
    updated: [],
    warnings: [],
  };
}

async function createDevProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "bshopify-dev-"));
  tempDirs.push(cwd);

  await writeFile(join(cwd, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  await writeFile(
    join(cwd, "shopify.app.dev.toml"),
    [
      'name = "fixture"',
      'client_id = "client-id"',
      "",
      "[app_proxy]",
      'prefix = "apps"',
      'subpath = "fixture-dev"',
      'url = "https://example.test/proxy"',
      "",
    ].join("\n"),
  );
  await mkdir(join(cwd, "extensions", "theme-extension", "blocks"), { recursive: true });
  await writeFile(
    join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid"),
    '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__"></div>\n',
  );
  await writeFile(
    join(cwd, "extensions", "theme-extension", "__entry.js"),
    [
      "export default {",
      "  async prepare(ctx) {",
      "    return {",
      "      extension: ctx.extension.name,",
      "      injections: [",
      "        {",
      '          file: "blocks/app-embed.liquid",',
      '          strategy: "replace",',
      '          pattern: "__SHOPIFY_APP_PROXY_BASE__",',
      "          value: ctx.extensionEnv.SHOPIFY_APP_PROXY_BASE,",
      "        },",
      "      ],",
      "    };",
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  return cwd;
}

async function readSourceFiles(dir: string): Promise<Array<{ path: string; content: string }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        return readSourceFiles(path);
      }

      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        return [];
      }

      return [{ path, content: await readFile(path, "utf8") }];
    }),
  );

  return files.flat();
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
  vi.restoreAllMocks();
});

describe("bshopify CLI", () => {
  it("exposes the package name and version", () => {
    expect(packageInfo.name).toBe("@bestfulfill/bshopify");
    expect(packageInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reads package metadata from package.json", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as { name: string; version: string };
    const sourceFiles = await readSourceFiles(join(process.cwd(), "src"));
    const hardcodedPackageInfo = sourceFiles
      .filter((file) => file.content.includes(`version: "${packageJson.version}"`))
      .map((file) => file.path);

    expect(packageInfo).toEqual({
      name: packageJson.name,
      version: packageJson.version,
    });
    expect(hardcodedPackageInfo).toEqual([]);
  });

  it("registers app-level bshopify commands", () => {
    const program = createCliProgram();
    const commands = program.commands
      .filter((command) => !isRuntimeHiddenCommand(command))
      .map((command) => command.name())
      .sort();
    const appCommand = program.commands.find((command) => command.name() === "app");

    expect(commands).toEqual(["app"]);
    expect(appCommand?.commands.map((command) => command.name()).sort()).toEqual([
      "dev",
      "guard",
      "init",
    ]);
  });

  it("builds app commands from the app command module", () => {
    const appCommand = createAppCommand();

    expect(appCommand.name()).toBe("app");
    expect(appCommand.commands.map((command) => command.name()).sort()).toEqual([
      "dev",
      "guard",
      "init",
    ]);
  });

  it("does not expose implicit help subcommands", () => {
    const programHelp = createCliProgram().helpInformation();
    const appHelp = createAppCommand().helpInformation();

    expect(programHelp).not.toContain("help [command]");
    expect(appHelp).not.toContain("help [command]");
  });

  it("uses extensionless relative TypeScript imports", async () => {
    const sourceFiles = await readSourceFiles(join(process.cwd(), "src"));
    const relativeImportWithExtensionPattern =
      /(?:from\s+["']|import\(["'])(?:\.{1,2}\/[^"']+)\.(?:js|ts)["']/;
    const offenders = sourceFiles
      .filter((file) => relativeImportWithExtensionPattern.test(file.content))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("uses root index.ts as the only explicit public re-export surface", async () => {
    const sourceFiles = await readSourceFiles(join(process.cwd(), "src"));
    const wildcardExportPattern = /export\s+\*\s+from\s+["'][^"']+["']/;
    const explicitReExportPattern =
      /export\s+(?:\{[\s\S]*?\}|type\s+\{[\s\S]*?\})\s+from\s+["'][^"']+["']/;
    const rootIndex = await readFile(join(process.cwd(), "src", "index.ts"), "utf8");
    const wildcardOffenders = sourceFiles
      .filter((file) => wildcardExportPattern.test(file.content))
      .map((file) => file.path);
    const offenders = sourceFiles
      .filter(
        (file) =>
          file.path !== join(process.cwd(), "src", "index.ts") &&
          explicitReExportPattern.test(file.content),
      )
      .map((file) => file.path);

    await expect(stat(join(process.cwd(), "src", "exports.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(rootIndex).toContain('export { createCliProgram, runCli, runShopifyCommand } from "./main";');
    expect(rootIndex).toContain('export { packageInfo } from "./package-info";');
    expect(rootIndex).toContain('export { devProject } from "./commands/app/dev";');
    expect(rootIndex).toContain('export { formatInitResult, initProject } from "./commands/app/init";');
    expect(rootIndex).toContain('export type { CliDependencies, ProcessRunner, ShopifyCommandRunner } from "./main";');
    expect(wildcardOffenders).toEqual([]);
    expect(offenders).toEqual([]);
  });

  it("keeps CLI runtime code in main.ts", async () => {
    const sourceFiles = await readSourceFiles(join(process.cwd(), "src"));
    const cliProgramReferences = sourceFiles
      .filter((file) => file.content.includes("cli-program"))
      .map((file) => file.path);

    await expect(stat(join(process.cwd(), "src", "main.ts"))).resolves.toBeTruthy();
    expect(cliProgramReferences).toEqual([]);
  });

  it("dispatches bshopify app init to the local initializer", async () => {
    const initProject = vi.fn(async () => createEmptyInitResult());
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await createCliProgram({ initProject }).parseAsync([
        "node",
        "bshopify",
        "app",
        "init",
        "--check",
        "--cwd",
        "/tmp/shopify-app",
      ]);
    } finally {
      log.mockRestore();
    }

    expect(initProject).toHaveBeenCalledWith({
      check: true,
      cwd: "/tmp/shopify-app",
    });
  });

  it("dispatches bshopify app dev to the local dev runner", async () => {
    const runDev = vi.fn(async () => 0);

    await createCliProgram({ runDev }).parseAsync([
      "node",
      "bshopify",
      "app",
      "dev",
      "--cwd",
      "/tmp/shopify-app",
      "--",
      "--reset",
    ]);

    expect(runDev).toHaveBeenCalledWith({
      cwd: "/tmp/shopify-app",
      shopifyArgs: ["--reset"],
    });
  });

  it("falls back to the Shopify CLI for commands bshopify does not intercept", async () => {
    const runShopifyCommand = vi.fn(async () => 0);

    await runCli(
      ["node", "bshopify", "theme", "dev", "--store", "example.myshopify.com"],
      { runShopifyCommand },
    );

    expect(runShopifyCommand).toHaveBeenCalledWith([
      "theme",
      "dev",
      "--store",
      "example.myshopify.com",
    ]);
  });

  it("falls back to Shopify help for commands bshopify does not intercept", async () => {
    const runShopifyCommand = vi.fn(async () => 0);

    await runCli(["node", "bshopify", "help", "theme", "dev"], {
      runShopifyCommand,
    });

    expect(runShopifyCommand).toHaveBeenCalledWith(["help", "theme", "dev"]);
  });

  it("keeps the generated pre-commit app guard command local", async () => {
    const runShopifyCommand = vi.fn(async () => 0);

    await runCli(["node", "bshopify", "app", "guard"], { runShopifyCommand });

    expect(runShopifyCommand).not.toHaveBeenCalled();
  });

  it("falls back top-level guard to Shopify because guard is app-scoped", async () => {
    const runShopifyCommand = vi.fn(async () => 0);

    await runCli(["node", "bshopify", "guard"], { runShopifyCommand });

    expect(runShopifyCommand).toHaveBeenCalledWith(["guard"]);
  });

  it("falls back through the user's Shopify CLI installation", async () => {
    const runShopifyCommand = vi.fn(async () => 0);

    await runCli(["node", "bshopify", "theme", "pull"], { runShopifyCommand });

    expect(runShopifyCommand).toHaveBeenCalledWith(["theme", "pull"]);
  });

  it("uses execa local binary preference for Shopify CLI fallback", async () => {
    const runner = vi.fn(async () => ({ exitCode: 0 }));

    await runShopifyCommand(["theme", "pull"], runner);

    expect(runner).toHaveBeenCalledWith("shopify", ["theme", "pull"], {
      localDir: process.cwd(),
      preferLocal: true,
      stdio: "inherit",
    });
  });
});

describe("devProject", () => {
  it("injects dev app proxy values while Shopify dev runs and restores placeholders afterward", async () => {
    const cwd = await createDevProject();
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    const runShopifyCommand = vi.fn(async () => {
      await expect(readFile(targetPath, "utf8")).resolves.toContain(
        'data-api-base="/apps/fixture-dev"',
      );
      await writeFile(
        targetPath,
        '<div data-api-base="/apps/fixture-dev"></div>\n<p>edited during dev</p>\n',
      );
      return 0;
    });

    const exitCode = await devProject({ cwd, runShopifyCommand });

    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__"></div>\n<p>edited during dev</p>\n',
    );
    await expect(readFile(join(cwd, ".bshopify-tmp", "extension-prepare.lock"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(exitCode).toBe(0);
    expect(runShopifyCommand).toHaveBeenCalledWith(["app", "dev", "--config", "dev"]);
  });

  it("fails before Shopify dev when Liquid placeholders remain unresolved", async () => {
    const cwd = await createDevProject();
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    await writeFile(
      targetPath,
      [
        '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__">',
        '  <span data-value="__UNRESOLVED_PLACEHOLDER__"></span>',
        "</div>",
        "",
      ].join("\n"),
    );
    const runShopifyCommand = vi.fn(async () => 0);

    await expect(devProject({ cwd, runShopifyCommand })).rejects.toThrow(
      "Unresolved deploy placeholders found after extension entry injection.",
    );

    await expect(readFile(targetPath, "utf8")).resolves.toContain(
      "__SHOPIFY_APP_PROXY_BASE__",
    );
    expect(runShopifyCommand).not.toHaveBeenCalled();
  });
});

function isRuntimeHiddenCommand(command: unknown): boolean {
  return (command as CommandWithRuntimeHiddenFlag)._hidden === true;
}
