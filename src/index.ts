export { createCliProgram, runCli, runShopifyCommand } from "./main";
export { packageInfo } from "./utils/package-json";
export { deployProject } from "./app/commands/deploy";
export { devProject } from "./app/commands/dev";
export { formatInitResult, initProject } from "./app/commands/init";

export type { CliDependencies, ProcessRunner, ShopifyCommandRunner } from "./main";
export type { PackageInfo } from "./utils/package-json";
export type { DeployOptions } from "./app/runner/types";
export type { DevOptions } from "./app/runner/types";
export type { InitCheck, InitOptions, InitResult } from "./app/commands/init/types";
