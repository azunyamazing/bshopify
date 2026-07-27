import { describe, expect, it, vi } from "vitest";
import { createAppCommand } from "../src/commands/app/index.js";
import {
  createCliProgram,
  packageInfo,
  runShopifyCommand,
  runCli,
} from "../src/index.js";

interface CommandWithRuntimeHiddenFlag {
  _hidden?: boolean;
}

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

describe("bshopify CLI", () => {
  it("exposes the package name and version", () => {
    expect(packageInfo.name).toBe("@bestfulfill/bshopify");
    expect(packageInfo.version).toMatch(/^\d+\.\d+\.\d+/);
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
      "guard",
      "init",
    ]);
  });

  it("builds app commands from the app command module", () => {
    const appCommand = createAppCommand();

    expect(appCommand.name()).toBe("app");
    expect(appCommand.commands.map((command) => command.name()).sort()).toEqual([
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

function isRuntimeHiddenCommand(command: unknown): boolean {
  return (command as CommandWithRuntimeHiddenFlag)._hidden === true;
}
