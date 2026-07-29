import { ansi, colorize } from "#/utils/output";
import type { ExtensionEntry, RunnerContextBase } from "#/app/runner/types";

export function formatDeploySummary(
  context: RunnerContextBase,
  entries: ExtensionEntry[],
  dryRun: boolean,
): string {
  return [
    "",
    formatBadge(dryRun ? " DEPLOY DRY-RUN SUMMARY " : " DEPLOY SUMMARY "),
    "",
    ...formatSummaryField("Environment", context.configName),
    ...formatSummaryField("Config file", context.shopify.configFile),
    ...formatSummaryField("Application URL", context.shopify.applicationUrl),
    ...formatSummaryField("App Proxy", context.appProxy?.apiBase),
    ...formatSummaryField("Target URL", context.appProxy?.targetUrl),
    ...formatSummaryField(
      "Extensions",
      entries.length > 0 ? entries.map((entry) => entry.extension.name).join(", ") : undefined,
    ),
    ...formatImportantProductionConfig(context),
    "",
  ].join("\n");
}

export function formatRestoreNotice(dryRun: boolean): string {
  const message = dryRun
    ? "Deploy dry-run extension files restored."
    : "Deploy extension files restored.";

  return `\n${colorize(colorize(message, ansi.cyan), ansi.bold)}\n`;
}

function formatImportantProductionConfig(context: RunnerContextBase): string[] {
  if (context.configName !== "production" || context.shopify.importantConfig.length === 0) {
    return [];
  }

  return [
    "",
    colorize(colorize("Important production config", ansi.yellow), ansi.bold),
    ...context.shopify.importantConfig.map(
      (item) => `  ${colorize(item.label, ansi.gray)}: ${colorize(item.value, ansi.yellow)}`,
    ),
  ];
}

function formatBadge(label: string): string {
  return colorize(colorize(colorize(label, ansi.black), ansi.bgCyan), ansi.bold);
}

function formatSummaryField(label: string, value: string | undefined): string[] {
  return [
    `  ${colorize(colorize(label, ansi.cyan), ansi.bold)}`,
    `    ${formatSummaryValue(value)}`,
    "",
  ];
}

function formatSummaryValue(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    return colorize("(not configured)", ansi.gray);
  }

  return colorize(value, ansi.bold);
}
