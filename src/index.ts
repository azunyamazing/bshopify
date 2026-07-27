import { Command } from "commander";
import {
  formatInitResult,
  initProject,
  type InitOptions,
} from "./commands/init/index.js";

export { formatInitResult, initProject };
export type { InitCheck, InitOptions, InitResult } from "./commands/init/index.js";

export interface PackageInfo {
  name: string;
  version: string;
}

interface CommandDefinition {
  name: string;
  description: string;
}

interface InitCommandOptions {
  check?: boolean;
  cwd?: string;
}

export const packageInfo: PackageInfo = {
  name: "@bestfulfill/bshopify",
  version: "0.1.0",
};

const commandDefinitions: CommandDefinition[] = [
  {
    name: "dev",
    description: "Run shopify app dev with temporary extension injections.",
  },
  {
    name: "deploy",
    description:
      "Run shopify app deploy with validation, injection, and restore.",
  },
  {
    name: "validate",
    description:
      "Validate runner config, Shopify config, entries, and injections.",
  },
  {
    name: "guard",
    description:
      "Prevent unsafe injected values or active locks from being committed.",
  },
  {
    name: "restore <runId>",
    description: "Restore files from a previous bshopify transaction.",
  },
];

export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("bshopify")
    .description("BestFulfill Shopify App Runner")
    .version(packageInfo.version)
    .showHelpAfterError();

  program
    .command("init")
    .description("Initialize bshopify in the current Shopify app project.")
    .option("--check", "only check project readiness without writing files")
    .option("--cwd <path>", "project directory to initialize")
    .action(async (options: InitCommandOptions) => {
      const result = await initProject(toInitOptions(options));
      console.log(formatInitResult(result));

      if (result.errors.length > 0) {
        process.exitCode = 1;
      }
    });

  for (const commandDefinition of commandDefinitions) {
    program
      .command(commandDefinition.name)
      .description(commandDefinition.description);
  }

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await createCliProgram().parseAsync(argv);
}

function toInitOptions(options: InitCommandOptions): InitOptions {
  return {
    check: options.check,
    cwd: options.cwd,
  };
}
