#!/usr/bin/env node
import { runCli } from "./main";
import { formatCliError } from "./utils/output";

runCli().catch((error: unknown) => {
  console.error(formatCliError(error));
  process.exitCode = 1;
});
