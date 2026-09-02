import { ansi, colorize } from "#/utils/output";
import { isRecord, readRecordString } from "#/utils/objects";
import type { RunnerContextBase } from "#/app/runner/types";
import type { ManagedEntry } from "#/extension/types";

interface DisplayAppProxy {
  apiBase: string;
  targetUrl?: string;
}

export function formatDeploySummary(
  context: RunnerContextBase,
  entries: ManagedEntry[],
  dryRun: boolean,
): string {
  const appProxy = readAppProxy(context.appConfig);

  return [
    "",
    formatBadge(dryRun ? " DEPLOY DRY-RUN SUMMARY " : " DEPLOY SUMMARY "),
    "",
    ...formatSummaryField("Environment", context.env),
    ...formatSummaryField("Config file", context.configPath),
    ...formatSummaryField("Application URL", readRecordString(context.appConfig, "application_url")),
    ...formatSummaryField("App Proxy", appProxy?.apiBase),
    ...formatSummaryField("Target URL", appProxy?.targetUrl),
    ...formatSummaryField(
      "Extensions",
      entries.length > 0 ? entries.map((entry) => entry.extension.name).join(", ") : undefined,
    ),
    "",
  ].join("\n");
}

export function formatRestoreNotice(dryRun: boolean): string {
  const message = dryRun
    ? "Deploy dry-run extension files restored."
    : "Deploy extension files restored.";

  return `\n${colorize(colorize(message, ansi.cyan), ansi.bold)}\n`;
}

function readAppProxy(config: Record<string, unknown>): DisplayAppProxy | undefined {
  const appProxy = config.app_proxy;

  if (!isRecord(appProxy)) {
    return undefined;
  }

  const prefix = readRecordString(appProxy, "prefix");
  const subpath = readRecordString(appProxy, "subpath");

  if (prefix === undefined || subpath === undefined) {
    return undefined;
  }

  return {
    apiBase: `/${prefix}/${subpath}`,
    targetUrl: readRecordString(appProxy, "url"),
  };
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
