import { Command } from "commander";
import {
  formatInitResult,
  initProject,
} from "./init";
import { devProject } from "./dev";
import type { InitOptions, InitResult } from "./init/types";
import type { DevOptions } from "../runner/types";

interface DevCommandOptions {
  config?: string;
  cwd?: string;
}

interface InitCommandOptions {
  check?: boolean;
  cwd?: string;
}

export interface AppCommandDependencies {
  runDev?: (options?: DevOptions) => Promise<number | void>;
  initProject?: (options?: InitOptions) => Promise<InitResult>;
}

const localAppCommands = new Set(["dev", "guard", "init"]);

export function createAppCommand(dependencies: AppCommandDependencies = {}): Command {
  const runDev = dependencies.runDev ?? devProject;
  const initializeProject = dependencies.initProject ?? initProject;
  const appCommand = new Command("app").description(
    "BestFulfill wrappers for Shopify app commands.",
  );
  appCommand.addHelpCommand(false);

  appCommand
    .command("init")
    .description("Initialize bshopify in the current Shopify app project.")
    .option("--check", "only check project readiness without writing files")
    .option("--cwd <path>", "project directory to initialize")
    .action(async (options: InitCommandOptions) => {
      const result = await initializeProject(toInitOptions(options));
      console.log(formatInitResult(result));

      if (result.errors.length > 0) {
        process.exitCode = 1;
      }
    });

  appCommand
    .command("dev")
    .description("Run Shopify app dev with temporary extension config injection.")
    .option("--config <name>", "Shopify app config name to run", "dev")
    .option("--cwd <path>", "project directory to run")
    .allowUnknownOption(true)
    .argument("[shopifyArgs...]", "extra arguments passed to Shopify CLI after --")
    .action(async (shopifyArgs: string[], options: DevCommandOptions) => {
      const exitCode = await runDev(toDevOptions(options, shopifyArgs));

      if (typeof exitCode === "number") {
        process.exitCode = exitCode;
      }
    });

  appCommand
    .command("guard")
    .description("Prevent unsafe injected values or active locks from being committed.")
    .action(() => undefined);

  return appCommand;
}

function toDevOptions(
  options: DevCommandOptions,
  shopifyArgs: string[] | undefined,
): DevOptions {
  return {
    configName: options.config,
    cwd: options.cwd,
    shopifyArgs: shopifyArgs ?? [],
  };
}

export function shouldHandleAppCommandLocally(args: string[]): boolean {
  const [subcommand] = args;

  return (
    subcommand === undefined ||
    isHelpOption(subcommand) ||
    localAppCommands.has(subcommand)
  );
}

export function shouldHandleAppHelpLocally(args: string[]): boolean {
  const [subcommand] = args;

  return subcommand === undefined || localAppCommands.has(subcommand);
}

function toInitOptions(options: InitCommandOptions): InitOptions {
  return {
    check: options.check,
    cwd: options.cwd,
  };
}

function isHelpOption(value: string): boolean {
  return value === "--help" || value === "-h";
}
