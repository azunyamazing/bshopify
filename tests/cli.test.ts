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

vi.mock("@inquirer/prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@inquirer/prompts")>();

  return {
    ...actual,
    confirm: vi.fn(async () => true),
    input: vi.fn(async () => "production"),
  };
});

import { createAppCommand } from "../src/app/commands";
import { formatDeploySummary } from "../src/app/commands/deploy/summary";
import { formatCliError } from "../src/utils/output";
import {
  createCliProgram,
  deployProject,
  devProject,
  packageInfo,
  runShopifyCommand,
  runCli,
} from "../src";

interface CommandWithRuntimeHiddenFlag {
  _hidden?: boolean;
}

interface PackageJsonFixture {
  name: string;
  scripts: Record<string, string>;
  version: string;
}

interface TsConfigFixture {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

interface DeploySummaryContextFixture {
  appProxy?: {
    apiBase: string;
    prefix: string;
    subpath: string;
    targetUrl: string;
  };
  command: "deploy";
  configName: string;
  env: string;
  extensionEnv: {
    APP_ENV: string;
    SHOPIFY_CONFIG_NAME: string;
  };
  runtimeConfig: Record<string, unknown>;
  shopify: {
    applicationUrl?: string;
    configFile: string;
    importantConfig: Array<{ label: string; value: string }>;
  };
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

function createShopifyBasicConfig(applicationUrl: string): string[] {
  return [
    'client_id = "client-id"',
    'name = "fixture"',
    `application_url = "${applicationUrl}"`,
  ];
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
  it("formats thrown CLI errors with red spacing", () => {
    const output = formatCliError(
      new Error(
        [
          "Unresolved deploy placeholders found after extension entry injection.",
          "  - extensions/theme-extension/blocks/app-embed.liquid: __SHOPIFY_APP_PROXY_BASE__",
        ].join("\n"),
      ),
    );

    expect(output).toBe(
      [
        "",
        "\u001B[1m\u001B[31mError\u001B[39m\u001B[22m",
        "",
        "\u001B[31m  Unresolved deploy placeholders found after extension entry injection.\u001B[39m",
        "\u001B[31m  - extensions/theme-extension/blocks/app-embed.liquid: __SHOPIFY_APP_PROXY_BASE__\u001B[39m",
        "",
      ].join("\n"),
    );
  });

  it("formats deploy summaries as a prominent block with long values on their own lines", () => {
    const output = formatDeploySummary(
      {
        appProxy: undefined,
        command: "deploy",
        configName: "test",
        env: "test",
        extensionEnv: {
          APP_ENV: "test",
          SHOPIFY_CONFIG_NAME: "test",
        },
        runtimeConfig: {},
        shopify: {
          applicationUrl: "https://api.platform.test.standhigher.com/api/v2/shopify/entry/test",
          configFile: "shopify.app.test.toml",
          importantConfig: [],
        },
      } as DeploySummaryContextFixture,
      [],
      false,
    );

    expect(output).toContain("\u001B[1m\u001B[46m\u001B[30m DEPLOY SUMMARY \u001B[39m\u001B[49m\u001B[22m");
    expect(output).toContain("\n  \u001B[1m\u001B[36mApplication URL\u001B[39m\u001B[22m\n    \u001B[1mhttps://api.platform.test.standhigher.com/api/v2/shopify/entry/test\u001B[22m");
    expect(output).toContain("\n  \u001B[1m\u001B[36mApp Proxy\u001B[39m\u001B[22m\n    \u001B[90m(not configured)\u001B[39m");
    expect(output).not.toContain("Application URL:");
  });

  it("omits imported production config review details from deploy summaries", () => {
    const output = formatDeploySummary(
      {
        appProxy: undefined,
        command: "deploy",
        configName: "production",
        env: "production",
        extensionEnv: {
          APP_ENV: "production",
          SHOPIFY_CONFIG_NAME: "production",
        },
        runtimeConfig: {},
        shopify: {
          applicationUrl: "https://api.platform.test.standhigher.com/api/v2/shopify/entry/production",
          configFile: "shopify.app.production.toml",
          importantConfig: [
            {
              label: "application_url",
              value: "https://api.platform.test.standhigher.com/api/v2/shopify/entry/production",
            },
            {
              label: "webhooks.api_version",
              value: "2026-01",
            },
          ],
        },
      } as DeploySummaryContextFixture,
      [],
      false,
    );

    expect(output).toContain("\u001B[1m\u001B[46m\u001B[30m DEPLOY SUMMARY \u001B[39m\u001B[49m\u001B[22m");
    expect(output).toContain("\n  \u001B[1m\u001B[36mApplication URL\u001B[39m\u001B[22m\n    \u001B[1mhttps://api.platform.test.standhigher.com/api/v2/shopify/entry/production\u001B[22m");
    expect(output).not.toContain("PRODUCTION CONFIG REVIEW REQUIRED");
    expect(output).not.toContain("Review these imported Shopify production values before deploy.");
    expect(output).not.toContain("application_url");
    expect(output).not.toContain("webhooks.api_version");
  });

  it("exposes the package name and version", () => {
    expect(packageInfo.name).toBe("@bestfulfill/bshopify");
    expect(packageInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reads package metadata from package.json", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJsonFixture;
    const rootIndex = await readFile(join(process.cwd(), "src", "index.ts"), "utf8");
    const mainSource = await readFile(join(process.cwd(), "src", "main.ts"), "utf8");
    const packageJsonSource = await readFile(
      join(process.cwd(), "src", "utils", "package-json.ts"),
      "utf8",
    );
    const tsupConfig = await readFile(join(process.cwd(), "tsup.config.ts"), "utf8");
    const sourceFiles = await readSourceFiles(join(process.cwd(), "src"));
    const hardcodedPackageInfo = sourceFiles
      .filter((file) => file.content.includes(`version: "${packageJson.version}"`))
      .map((file) => file.path);

    expect(packageInfo).toEqual({
      name: packageJson.name,
      version: packageJson.version,
    });
    await expect(stat(join(process.cwd(), "src", "package-info.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(rootIndex).toContain('export { packageInfo } from "./utils/package-json";');
    expect(rootIndex).toContain('export type { PackageInfo } from "./utils/package-json";');
    expect(mainSource).toContain('./utils/package-json');
    expect(packageJsonSource).toContain("export const packageInfo");
    expect(packageJsonSource).toContain("__BSHOPIFY_PACKAGE_NAME__");
    expect(packageJsonSource).toContain("__BSHOPIFY_PACKAGE_VERSION__");
    expect(tsupConfig).toContain("__BSHOPIFY_PACKAGE_NAME__");
    expect(tsupConfig).toContain("__BSHOPIFY_PACKAGE_VERSION__");
    expect(packageJson.scripts.check).toContain("npm run verify:dist");
    expect(packageJson.scripts["verify:dist"]).toBe("node dist/cli.js --help");
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
      "deploy",
      "dev",
      "guard",
      "init",
    ]);
  });

  it("builds app commands from the app command module", () => {
    const appCommand = createAppCommand();

    expect(appCommand.name()).toBe("app");
    expect(appCommand.commands.map((command) => command.name()).sort()).toEqual([
      "deploy",
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

  it("uses source path aliases instead of deep relative imports", async () => {
    const tsconfig = JSON.parse(
      await readFile(join(process.cwd(), "tsconfig.json"), "utf8"),
    ) as TsConfigFixture;
    const vitestConfig = await readFile(
      join(process.cwd(), "vitest.config.ts"),
      "utf8",
    );
    const sourceFiles = await readSourceFiles(join(process.cwd(), "src"));
    const deepRelativeImportPattern =
      /(?:from\s+["']|import\(["'])\.\.\/\.\.\/(?:[^"']*)["']/;
    const offenders = sourceFiles
      .filter((file) => deepRelativeImportPattern.test(file.content))
      .map((file) => file.path);

    expect(tsconfig.compilerOptions?.baseUrl).toBe(".");
    expect(tsconfig.compilerOptions?.paths?.["#/*"]).toEqual(["src/*"]);
    expect(vitestConfig).toContain('find: "#"');
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
    expect(rootIndex).toContain('export { packageInfo } from "./utils/package-json";');
    expect(rootIndex).toContain('export { deployProject } from "./app/commands/deploy";');
    expect(rootIndex).toContain('export { devProject } from "./app/commands/dev";');
    expect(rootIndex).toContain('export { formatInitResult, initProject } from "./app/commands/init";');
    expect(rootIndex).toContain('export type { CliDependencies, ProcessRunner, ShopifyCommandRunner } from "./main";');
    expect(rootIndex).toContain('export type { PackageInfo } from "./utils/package-json";');
    expect(rootIndex).toContain('export type { DeployOptions } from "./app/runner/types";');
    expect(rootIndex).toContain('export type { DevOptions } from "./app/runner/types";');
    expect(rootIndex).toContain('export type { InitCheck, InitOptions, InitResult } from "./app/commands/init/types";');
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

  it("keeps reusable app runner modules above concrete commands", async () => {
    const rootUtilsSourceFiles = await readSourceFiles(
      join(process.cwd(), "src", "utils"),
    );
    const appUtilsSourceFiles = await readSourceFiles(
      join(process.cwd(), "src", "app", "utils"),
    );
    const runnerSourceFiles = await readSourceFiles(
      join(process.cwd(), "src", "app", "runner"),
    );
    const deploySourceFiles = await readSourceFiles(
      join(process.cwd(), "src", "app", "commands", "deploy"),
    );
    const devSourceFiles = await readSourceFiles(
      join(process.cwd(), "src", "app", "commands", "dev"),
    );
    const initSourceFiles = await readSourceFiles(
      join(process.cwd(), "src", "app", "commands", "init"),
    );
    const oversizedFiles = [
      ...rootUtilsSourceFiles,
      ...appUtilsSourceFiles,
      ...runnerSourceFiles,
      ...deploySourceFiles,
      ...devSourceFiles,
      ...initSourceFiles,
    ]
      .filter((file) => file.content.split(/\r?\n/).length > 250)
      .map((file) => file.path);
    expect(rootUtilsSourceFiles.map((file) => file.path).sort()).toEqual(
      expect.arrayContaining([
        join(process.cwd(), "src", "utils", "config.ts"),
        join(process.cwd(), "src", "utils", "files.ts"),
        join(process.cwd(), "src", "utils", "node.ts"),
        join(process.cwd(), "src", "utils", "objects.ts"),
        join(process.cwd(), "src", "utils", "output.ts"),
        join(process.cwd(), "src", "utils", "package-json.ts"),
        join(process.cwd(), "src", "utils", "markers.ts"),
        join(process.cwd(), "src", "utils", "paths.ts"),
      ]),
    );
    expect(appUtilsSourceFiles.map((file) => file.path).sort()).toEqual([
      join(process.cwd(), "src", "app", "utils", "extensions.ts"),
    ]);
    await expect(stat(join(process.cwd(), "src", "app", "runner", "utils.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(process.cwd(), "src", "app", "runner", "markers.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(process.cwd(), "src", "app", "utils.ts"))).rejects.toMatchObject({ code: "ENOENT" });

    expect(runnerSourceFiles.map((file) => file.path).sort()).toEqual(
      expect.arrayContaining([
        join(process.cwd(), "src", "app", "runner", "config.ts"),
        join(process.cwd(), "src", "app", "runner", "context.ts"),
        join(process.cwd(), "src", "app", "runner", "entries.ts"),
        join(process.cwd(), "src", "app", "runner", "injections.ts"),
        join(process.cwd(), "src", "app", "runner", "lock.ts"),
        join(process.cwd(), "src", "app", "runner", "shopify.ts"),
        join(process.cwd(), "src", "app", "runner", "transaction.ts"),
        join(process.cwd(), "src", "app", "runner", "types.ts"),
      ]),
    );
    expect(deploySourceFiles.map((file) => file.path).sort()).toEqual([
      join(process.cwd(), "src", "app", "commands", "deploy", "config.ts"),
      join(process.cwd(), "src", "app", "commands", "deploy", "index.ts"),
      join(process.cwd(), "src", "app", "commands", "deploy", "summary.ts"),
    ]);
    expect(devSourceFiles.map((file) => file.path).sort()).toEqual([
      join(process.cwd(), "src", "app", "commands", "dev", "index.ts"),
    ]);
    expect(initSourceFiles.map((file) => file.path).sort()).toEqual(
      expect.arrayContaining([
        join(process.cwd(), "src", "app", "commands", "init", "checks.ts"),
        join(process.cwd(), "src", "app", "commands", "init", "constants.ts"),
        join(process.cwd(), "src", "app", "commands", "init", "files.ts"),
        join(process.cwd(), "src", "app", "commands", "init", "git-hooks.ts"),
        join(process.cwd(), "src", "app", "commands", "init", "index.ts"),
        join(process.cwd(), "src", "app", "commands", "init", "paths.ts"),
        join(process.cwd(), "src", "app", "commands", "init", "types.ts"),
        join(process.cwd(), "src", "app", "commands", "init", "utils.ts"),
      ]),
    );
    expect(oversizedFiles).toEqual([]);
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

  it("dispatches bshopify app deploy to the local deploy runner", async () => {
    const runDeploy = vi.fn(async () => 0);

    await createCliProgram({ runDeploy }).parseAsync([
      "node",
      "bshopify",
      "app",
      "deploy",
      "--cwd",
      "/tmp/shopify-app",
      "--config",
      "test",
      "--dry-run",
      "--yes",
      "--",
      "--source-control-url",
      "https://example.test/commit",
    ]);

    expect(runDeploy).toHaveBeenCalledWith({
      configName: "test",
      confirmProduction: false,
      cwd: "/tmp/shopify-app",
      dryRun: true,
      shopifyArgs: ["--source-control-url", "https://example.test/commit"],
      yes: true,
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
      configName: "dev",
      cwd: "/tmp/shopify-app",
      shopifyArgs: ["--reset"],
    });
  });

  it("dispatches bshopify app dev with a matching Shopify config", async () => {
    const runDev = vi.fn(async () => 0);

    await createCliProgram({ runDev }).parseAsync([
      "node",
      "bshopify",
      "app",
      "dev",
      "--cwd",
      "/tmp/shopify-app",
      "--config",
      "test",
      "--",
      "--reset",
    ]);

    expect(runDev).toHaveBeenCalledWith({
      configName: "test",
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
        "/apps/fixture-dev",
      );
      const current = await readFile(targetPath, "utf8");
      await writeFile(
        targetPath,
        `${current}<p>edited during dev</p>\n`,
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

  it("uses the selected config for app dev context and Shopify CLI", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.test.toml"),
      [
        'name = "fixture"',
        "",
        "[app_proxy]",
        'prefix = "apps"',
        'subpath = "fixture-test"',
        'url = "https://example.test/proxy"',
        "",
      ].join("\n"),
    );
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    const runShopifyCommand = vi.fn(async () => {
      await expect(readFile(targetPath, "utf8")).resolves.toContain(
        "/apps/fixture-test",
      );
      return 0;
    });

    await devProject({ configName: "test", cwd, runShopifyCommand });

    expect(runShopifyCommand).toHaveBeenCalledWith(["app", "dev", "--config", "test"]);
  });

  it("prints the dev placeholder injection details with color", async () => {
    const cwd = await createDevProject();
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    await writeFile(
      targetPath,
      [
        '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__">',
        '  <span data-env="__SHOPIFY_CONFIG_NAME__"></span>',
        "</div>",
        "",
      ].join("\n"),
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
        "        {",
        '          file: "blocks/app-embed.liquid",',
        '          strategy: "replace",',
        '          pattern: "__SHOPIFY_CONFIG_NAME__",',
        "          value: ctx.extensionEnv.SHOPIFY_CONFIG_NAME,",
        "        },",
        "      ],",
        "    };",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runShopifyCommand = vi.fn(async () => 0);
    let output = "";

    try {
      await devProject({ cwd, runShopifyCommand });
      output = log.mock.calls.map(([message]) => String(message)).join("\n");
    } finally {
      log.mockRestore();
    }

    expect(output).toContain("\u001B[1m\u001B[36mDev extension injections\u001B[39m\u001B[22m");
    expect(output).toContain(
      "\u001B[90mReason:\u001B[39m temporary values for shopify app dev --config dev; restored when dev exits.",
    );
    expect(output).toContain(
      [
        "\u001B[90mReason:\u001B[39m temporary values for shopify app dev --config dev; restored when dev exits.",
        "",
        "\u001B[36mextensions/theme-extension/blocks/app-embed.liquid\u001B[39m:",
        "    \u001B[33m__SHOPIFY_APP_PROXY_BASE__\u001B[39m \u001B[90m->\u001B[39m \u001B[35m/apps/fixture-dev\u001B[39m",
        "    \u001B[33m__SHOPIFY_CONFIG_NAME__\u001B[39m \u001B[90m->\u001B[39m \u001B[35mdev\u001B[39m",
      ].join("\n"),
    );
    expect(output.endsWith("\n")).toBe(true);
  });

  it("prints a restore notice with surrounding blank lines when dev exits", async () => {
    const cwd = await createDevProject();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runShopifyCommand = vi.fn(async () => 0);
    let restoreOutput = "";

    try {
      await devProject({ cwd, runShopifyCommand });
      restoreOutput = String(log.mock.calls.at(-1)?.[0] ?? "");
    } finally {
      log.mockRestore();
    }

    expect(restoreOutput).toBe(
      "\n\u001B[1m\u001B[36mDev extension files restored.\u001B[39m\u001B[22m\n",
    );
  });

  it("cleans a stale dev lock before preparing extensions", async () => {
    const cwd = await createDevProject();
    await mkdir(join(cwd, ".bshopify-tmp"), { recursive: true });
    await writeFile(join(cwd, ".bshopify-tmp", "extension-prepare.lock"), "999999999\n");
    const runShopifyCommand = vi.fn(async () => 0);

    await devProject({ cwd, runShopifyCommand });

    expect(runShopifyCommand).toHaveBeenCalledWith(["app", "dev", "--config", "dev"]);
    await expect(readFile(join(cwd, ".bshopify-tmp", "extension-prepare.lock"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restores a stale dev transaction before preparing extensions", async () => {
    const cwd = await createDevProject();
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    const marker = "{% comment %} bshopify-restore:stale {% endcomment %}";
    const transactionPath = join(cwd, ".bshopify-tmp", "extension-prepare.transaction.json");
    await mkdir(join(cwd, ".bshopify-tmp"), { recursive: true });
    await writeFile(join(cwd, ".bshopify-tmp", "extension-prepare.lock"), "999999999\n");
    await writeFile(
      targetPath,
      `<div data-api-base="/apps/fixture-dev${marker}"></div>\n`,
    );
    await writeFile(
      transactionPath,
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
    const runShopifyCommand = vi.fn(async () => {
      await expect(readFile(targetPath, "utf8")).resolves.toContain(
        "/apps/fixture-dev",
      );
      return 0;
    });

    await devProject({ cwd, runShopifyCommand });

    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__"></div>\n',
    );
    await expect(readFile(transactionPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("releases the dev lock when stale transaction recovery fails", async () => {
    const cwd = await createDevProject();
    const lockPath = join(cwd, ".bshopify-tmp", "extension-prepare.lock");
    await mkdir(join(cwd, ".bshopify-tmp"), { recursive: true });
    await writeFile(lockPath, "999999999\n");
    await writeFile(join(cwd, ".bshopify-tmp", "extension-prepare.transaction.json"), "{\n");

    await expect(devProject({ cwd, runShopifyCommand: vi.fn(async () => 0) })).rejects.toThrow();

    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restores only marker-wrapped injected values and keeps matching user edits", async () => {
    const cwd = await createDevProject();
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    const runShopifyCommand = vi.fn(async () => {
      const current = await readFile(targetPath, "utf8");
      await writeFile(
        targetPath,
        [
          current.trimEnd(),
          '<p data-copy="/apps/fixture-dev">edited during dev</p>',
          "",
        ].join("\n"),
      );
      return 0;
    });

    await devProject({ cwd, runShopifyCommand });

    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      [
        '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__"></div>',
        '<p data-copy="/apps/fixture-dev">edited during dev</p>',
        "",
      ].join("\n"),
    );
  });

  it("uses restore markers that match the target file type", async () => {
    const cwd = await createDevProject();
    const extensionRoot = join(cwd, "extensions", "theme-extension");
    const cases = [
      {
        file: "blocks/app-embed.liquid",
        markerPattern: "{% comment %} bshopify-restore:",
      },
      {
        file: "blocks/app-block.html",
        markerPattern: "<!-- bshopify-restore:",
      },
      {
        file: "assets/app.js",
        markerPattern: "/* bshopify-restore:",
      },
      {
        file: "assets/app.jsx",
        markerPattern: "{/* bshopify-restore:",
      },
      {
        file: "assets/app.tsx",
        markerPattern: "{/* bshopify-restore:",
      },
      {
        file: "assets/app.css",
        markerPattern: "/* bshopify-restore:",
      },
    ];
    await mkdir(join(extensionRoot, "assets"), { recursive: true });
    await writeFile(
      join(extensionRoot, "__entry.js"),
      [
        "export default {",
        "  async prepare(ctx) {",
        "    return {",
        "      injections: [",
        ...cases.map(
          ({ file }) =>
            `        { file: ${JSON.stringify(file)}, strategy: "replace", pattern: "__SHOPIFY_APP_PROXY_BASE__", value: ctx.extensionEnv.SHOPIFY_APP_PROXY_BASE },`,
        ),
        "      ],",
        "    };",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    for (const { file } of cases) {
      await mkdir(join(extensionRoot, file, ".."), { recursive: true });
      await writeFile(join(extensionRoot, file), "__SHOPIFY_APP_PROXY_BASE__\n");
    }

    const runShopifyCommand = vi.fn(async () => {
      for (const { file, markerPattern } of cases) {
        await expect(readFile(join(extensionRoot, file), "utf8")).resolves.toContain(
          markerPattern,
        );
      }
      return 0;
    });

    await devProject({ cwd, runShopifyCommand });

    for (const { file } of cases) {
      await expect(readFile(join(extensionRoot, file), "utf8")).resolves.toBe(
        "__SHOPIFY_APP_PROXY_BASE__\n",
      );
    }
  });

  it("can disable restore markers from runner config", async () => {
    const cwd = await createDevProject();
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    await writeFile(
      join(cwd, "bshopify.config.mjs"),
      "export default { restoreMarkers: false };\n",
    );
    const runShopifyCommand = vi.fn(async () => {
      const current = await readFile(targetPath, "utf8");

      expect(current).toContain('/apps/fixture-dev');
      expect(current).not.toContain("bshopify-restore:");
      return 0;
    });

    await devProject({ cwd, runShopifyCommand });

    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__"></div>\n',
    );
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

describe("deployProject", () => {
  it("deploys configs that pass Shopify basic fields without app proxy", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.test.toml"),
      [
        ...createShopifyBasicConfig("https://test.example.com"),
        "",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid"),
      "<div></div>\n",
    );
    await writeFile(
      join(cwd, "extensions", "theme-extension", "__entry.js"),
      "export default { async prepare() { return { injections: [] }; } };\n",
    );
    const runShopifyCommand = vi.fn(async () => 0);

    const exitCode = await deployProject({
      configName: "test",
      cwd,
      runShopifyCommand,
      yes: true,
    });

    expect(exitCode).toBe(0);
    expect(runShopifyCommand).toHaveBeenCalledWith(["app", "deploy", "--config", "test"]);
  });

  it("requires Shopify basic fields for deploy configs", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.test.toml"),
      [
        'client_id = "client-id"',
        'name = "fixture"',
        "",
      ].join("\n"),
    );
    const runShopifyCommand = vi.fn(async () => 0);

    await expect(
      deployProject({
        configName: "test",
        cwd,
        runShopifyCommand,
        yes: true,
      }),
    ).rejects.toThrow("shopify.app.test.toml application_url is required.");
    expect(runShopifyCommand).not.toHaveBeenCalled();
  });

  it("omits imported production config values from the deploy summary", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.production.toml"),
      [
        ...createShopifyBasicConfig("https://production.example.com"),
        "",
        "[webhooks]",
        'api_version = "2026-01"',
        "",
        "[[webhooks.subscriptions]]",
        'topics = ["orders/create", "orders/updated"]',
        'uri = "/webhooks/orders"',
        "",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid"),
      "<div></div>\n",
    );
    await writeFile(
      join(cwd, "extensions", "theme-extension", "__entry.js"),
      "export default { async prepare() { return { injections: [] }; } };\n",
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let output = "";

    try {
      await deployProject({
        configName: "production",
        cwd,
        dryRun: true,
        yes: true,
      });
      output = log.mock.calls.map(([message]) => String(message)).join("\n");
    } finally {
      log.mockRestore();
    }

    expect(output).toContain("DEPLOY DRY-RUN SUMMARY");
    expect(output).toContain("Application URL");
    expect(output).toContain("https://production.example.com");
    expect(output).not.toContain("PRODUCTION CONFIG REVIEW REQUIRED");
    expect(output).not.toContain("application_url");
    expect(output).not.toContain("webhooks.api_version");
    expect(output).not.toContain("webhooks.subscriptions[0].topics");
    expect(output).not.toContain("orders/create, orders/updated");
  });

  it("injects deploy values, hides extension entries during Shopify deploy, and restores afterward", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.test.toml"),
      [
        ...createShopifyBasicConfig("https://test.example.com"),
        "",
        "[app_proxy]",
        'prefix = "apps"',
        'subpath = "fixture-test"',
        'url = "https://example.test/proxy"',
        "",
      ].join("\n"),
    );
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    const entryPath = join(cwd, "extensions", "theme-extension", "__entry.js");
    const runShopifyCommand = vi.fn(async () => {
      await expect(readFile(targetPath, "utf8")).resolves.toContain(
        "/apps/fixture-test",
      );
      await expect(readFile(targetPath, "utf8")).resolves.not.toContain("bshopify-restore:");
      await expect(stat(entryPath)).rejects.toMatchObject({ code: "ENOENT" });
      return 0;
    });

    const exitCode = await deployProject({
      configName: "test",
      cwd,
      runShopifyCommand,
      yes: true,
    });

    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__"></div>\n',
    );
    await expect(readFile(entryPath, "utf8")).resolves.toContain("async prepare(ctx)");
    await expect(readFile(join(cwd, ".bshopify-tmp", "extension-prepare.lock"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(exitCode).toBe(0);
    expect(runShopifyCommand).toHaveBeenCalledWith(["app", "deploy", "--config", "test"]);
  });

  it("restores stale hidden deploy entries before preparing plans", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.test.toml"),
      [
        ...createShopifyBasicConfig("https://test.example.com"),
        "",
        "[app_proxy]",
        'prefix = "apps"',
        'subpath = "fixture-test"',
        'url = "https://example.test/proxy"',
        "",
      ].join("\n"),
    );
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    const entryPath = join(cwd, "extensions", "theme-extension", "__entry.js");
    const hiddenPath = `${entryPath}.bshopify-hidden-stale`;
    const transactionPath = join(cwd, ".bshopify-tmp", "extension-prepare.transaction.json");
    const entrySource = await readFile(entryPath, "utf8");
    await mkdir(join(cwd, ".bshopify-tmp"), { recursive: true });
    await writeFile(join(cwd, ".bshopify-tmp", "extension-prepare.lock"), "999999999\n");
    await writeFile(hiddenPath, entrySource);
    await rm(entryPath);
    await writeFile(
      transactionPath,
      `${JSON.stringify({
        files: [],
        hiddenFiles: [{ hiddenPath, path: entryPath }],
      })}\n`,
    );
    const runShopifyCommand = vi.fn(async () => {
      await expect(readFile(targetPath, "utf8")).resolves.toContain(
        "/apps/fixture-test",
      );
      return 0;
    });

    await deployProject({
      configName: "test",
      cwd,
      runShopifyCommand,
      yes: true,
    });

    await expect(readFile(entryPath, "utf8")).resolves.toBe(entrySource);
    await expect(readFile(transactionPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("runs deploy dry-runs without calling Shopify deploy", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.test.toml"),
      [
        ...createShopifyBasicConfig("https://test.example.com"),
        "",
        "[app_proxy]",
        'prefix = "apps"',
        'subpath = "fixture-test"',
        'url = "https://example.test/proxy"',
        "",
      ].join("\n"),
    );
    const targetPath = join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid");
    const runShopifyCommand = vi.fn(async () => 0);

    const exitCode = await deployProject({
      configName: "test",
      cwd,
      dryRun: true,
      runShopifyCommand,
      yes: true,
    });

    expect(exitCode).toBe(0);
    expect(runShopifyCommand).not.toHaveBeenCalled();
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      '<div data-api-base="__SHOPIFY_APP_PROXY_BASE__"></div>\n',
    );
  });

  it("requires explicit confirmation for production deploys", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.production.toml"),
      [
        ...createShopifyBasicConfig("https://production.example.com"),
        "",
        "[app_proxy]",
        'prefix = "apps"',
        'subpath = "fixture-production"',
        'url = "https://example.test/proxy"',
        "",
      ].join("\n"),
    );
    const runShopifyCommand = vi.fn(async () => 0);

    await expect(
      deployProject({
        configName: "production",
        cwd,
        runShopifyCommand,
        yes: true,
      }),
    ).rejects.toThrow("Production deploy requires --confirm-production.");
    expect(runShopifyCommand).not.toHaveBeenCalled();
  });

  it("shows the production summary before asking for the production confirmation text", async () => {
    const prompts = await import("@inquirer/prompts");
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.production.toml"),
      [
        ...createShopifyBasicConfig("https://production.example.com"),
        "",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid"),
      "<div></div>\n",
    );
    await writeFile(
      join(cwd, "extensions", "theme-extension", "__entry.js"),
      "export default { async prepare() { return { injections: [] }; } };\n",
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const runShopifyCommand = vi.fn(async () => 0);
    const events: string[] = [];
    log.mockImplementation(() => {
      events.push("summary");
    });
    vi.mocked(prompts.input).mockImplementationOnce(() => {
      events.push("confirm-production");
      return Object.assign(Promise.resolve("production"), {
        cancel: () => undefined,
      });
    });

    try {
      await deployProject({
        configName: "production",
        cwd,
        runShopifyCommand,
      });
    } finally {
      log.mockRestore();
    }

    expect(events.indexOf("summary")).toBeLessThan(events.indexOf("confirm-production"));
    expect(runShopifyCommand).toHaveBeenCalledWith([
      "app",
      "deploy",
      "--config",
      "production",
    ]);
  });

  it("prints a blank line before handing off to Shopify deploy output", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.production.toml"),
      [
        ...createShopifyBasicConfig("https://production.example.com"),
        "",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, "extensions", "theme-extension", "blocks", "app-embed.liquid"),
      "<div></div>\n",
    );
    await writeFile(
      join(cwd, "extensions", "theme-extension", "__entry.js"),
      "export default { async prepare() { return { injections: [] }; } };\n",
    );
    const events: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((message) => {
      events.push(message === "" ? "blank-line" : "bshopify-log");
    });
    const runShopifyCommand = vi.fn(async () => {
      events.push("shopify-deploy");
      return 0;
    });

    try {
      await deployProject({
        configName: "production",
        cwd,
        runShopifyCommand,
      });
    } finally {
      log.mockRestore();
    }

    expect(events[events.indexOf("shopify-deploy") - 1]).toBe("blank-line");
  });

  it("uses deploy wording when deploy injection values are missing", async () => {
    const cwd = await createDevProject();
    await writeFile(
      join(cwd, "shopify.app.test.toml"),
      [
        ...createShopifyBasicConfig("https://test.example.com"),
        "",
      ].join("\n"),
    );
    const runShopifyCommand = vi.fn(async () => 0);

    await expect(
      deployProject({
        configName: "test",
        cwd,
        runShopifyCommand,
        yes: true,
      }),
    ).rejects.toThrow("__SHOPIFY_APP_PROXY_BASE__ has no value for deploy.");
    expect(runShopifyCommand).not.toHaveBeenCalled();
  });
});

function isRuntimeHiddenCommand(command: unknown): boolean {
  return (command as CommandWithRuntimeHiddenFlag)._hidden === true;
}
