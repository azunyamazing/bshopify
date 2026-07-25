import { Command } from "commander";

export interface PackageInfo {
  name: string;
  version: string;
}

interface CommandDefinition {
  name: string;
  description: string;
}

export const packageInfo: PackageInfo = {
  name: "@bestfulfill/bshopify",
  version: "0.1.0",
};

const commandDefinitions: CommandDefinition[] = [
  {
    name: "init",
    description: "Initialize bshopify in the current Shopify app project.",
  },
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
