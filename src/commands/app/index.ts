import { Command } from "commander";
import {
  formatInitResult,
  initProject,
  type InitOptions,
  type InitResult,
} from "./init/index.js";

export { formatInitResult, initProject };
export type { InitCheck, InitOptions, InitResult } from "./init/index.js";

interface InitCommandOptions {
  check?: boolean;
  cwd?: string;
}

export interface AppCommandDependencies {
  initProject?: (options?: InitOptions) => Promise<InitResult>;
}

const localAppCommands = new Set(["guard", "init"]);

export function createAppCommand(dependencies: AppCommandDependencies = {}): Command {
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
    .command("guard")
    .description("Prevent unsafe injected values or active locks from being committed.")
    .action(() => undefined);

  return appCommand;
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
