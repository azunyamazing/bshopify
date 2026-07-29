type AnsiPair = readonly [string, string];

export interface SectionStyle {
  color: AnsiPair;
  prefix: string;
  title: string;
}

export const ansi = {
  bold: ["\u001B[1m", "\u001B[22m"],
  bgCyan: ["\u001B[46m", "\u001B[49m"],
  black: ["\u001B[30m", "\u001B[39m"],
  blue: ["\u001B[34m", "\u001B[39m"],
  cyan: ["\u001B[36m", "\u001B[39m"],
  gray: ["\u001B[90m", "\u001B[39m"],
  green: ["\u001B[32m", "\u001B[39m"],
  magenta: ["\u001B[35m", "\u001B[39m"],
  red: ["\u001B[31m", "\u001B[39m"],
  yellow: ["\u001B[33m", "\u001B[39m"],
} satisfies Record<string, AnsiPair>;

export function colorize(value: string, color: AnsiPair): string {
  return `${color[0]}${value}${color[1]}`;
}

export function formatSection(label: string, items: string[]): string[] {
  if (items.length === 0) {
    return [];
  }

  const sectionStyle = getSectionStyle(label);

  return [
    "",
    colorize(colorize(sectionStyle.title, sectionStyle.color), ansi.bold),
    ...items.map((item) => `  ${colorize(sectionStyle.prefix, sectionStyle.color)} ${item}`),
  ];
}

export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return [
    "",
    colorize(colorize("Error", ansi.red), ansi.bold),
    "",
    ...(lines.length > 0
      ? lines.map((line) => colorize(`  ${line}`, ansi.red))
      : [colorize("  Unknown error", ansi.red)]),
    "",
  ].join("\n");
}

function getSectionStyle(label: string): SectionStyle {
  switch (label) {
    case "created":
      return { color: ansi.green, prefix: "+", title: "Created" };
    case "updated":
      return { color: ansi.cyan, prefix: "~", title: "Updated" };
    case "skipped":
      return { color: ansi.gray, prefix: "-", title: "Skipped" };
    case "warnings":
      return { color: ansi.yellow, prefix: "!", title: "Warnings" };
    case "errors":
      return { color: ansi.red, prefix: "x", title: "Errors" };
    default:
      return { color: ansi.bold, prefix: "-", title: label };
  }
}
