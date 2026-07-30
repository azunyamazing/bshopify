import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configFileName } from "./constants";
import type { InitResult } from "./types";

export async function mergeRunnerConfig(cwd: string, result: InitResult): Promise<void> {
  const configPath = join(cwd, configFileName);
  const current = await readFile(configPath, "utf8");
  const next = reconcileRunnerConfigSource(current);

  if (next === undefined) {
    result.warnings.push(`${configFileName} could not be merged automatically`);
    return;
  }

  if (next === current) {
    return;
  }

  await writeFile(configPath, next);
  result.updated.push(configFileName);
}

function reconcileRunnerConfigSource(source: string): string | undefined {
  const match = source.match(/export\s+default\s*\{([\s\S]*)\}\s*;?\s*$/);

  if (match === null || match.index === undefined) {
    return undefined;
  }

  const bodyStart = match.index + match[0].indexOf("{") + 1;
  const bodyEnd = source.lastIndexOf("}");
  if (bodyEnd < bodyStart) {
    return undefined;
  }

  const prefix = source.slice(0, bodyStart);
  const body = source.slice(bodyStart, bodyEnd);
  const suffix = source.slice(bodyEnd);
  const nextBody = mergeRunnerConfigBody(body);

  return `${prefix}${nextBody}${suffix.endsWith("\n") ? suffix : `${suffix}\n`}`;
}

function mergeRunnerConfigBody(body: string): string {
  const cleaned = body.replace(/\s+$/, "");
  const additions = [
    ["extensionsRoot", '  extensionsRoot: "extensions",'],
    ["entryFileName", '  entryFileName: "__entry.js",'],
    ["configFiles", [
      "  configFiles: {",
      '    dev: "shopify.app.dev.toml",',
      '    test: "shopify.app.test.toml",',
      '    production: "shopify.app.production.toml",',
      "  },",
    ].join("\n")],
    ["failOnUnresolvedPlaceholders", "  failOnUnresolvedPlaceholders: true,"],
    ["restoreMarkers", "  restoreMarkers: true,"],
  ] as const;
  const nextParts = [cleaned];

  for (const [propertyName, propertySource] of additions) {
    if (!hasTopLevelConfigProperty(cleaned, propertyName)) {
      nextParts.push(propertySource);
    }
  }

  const nextBody = nextParts
    .filter((part) => part.trim().length > 0)
    .join("\n\n");

  return `\n${nextBody}\n`;
}

function hasTopLevelConfigProperty(source: string, propertyName: string): boolean {
  const propertyPattern = new RegExp(
    `^\\s*(?:["']${escapeRegExp(propertyName)}["']|${escapeRegExp(propertyName)})\\s*:`,
  );
  let depth = 0;
  let isInsideBlockComment = false;

  for (const line of source.split(/\r?\n/)) {
    const lineWithoutComments = stripComments(line, isInsideBlockComment);
    isInsideBlockComment = lineWithoutComments.isInsideBlockComment;

    if (depth === 0 && propertyPattern.test(lineWithoutComments.source)) {
      return true;
    }

    depth = Math.max(0, depth + countBraceDelta(lineWithoutComments.source));
  }

  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countBraceDelta(line: string): number {
  let delta = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === "/" && next === "/") {
      break;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }
  }

  return delta;
}

interface StripCommentsResult {
  isInsideBlockComment: boolean;
  source: string;
}

function stripComments(line: string, isInsideBlockComment: boolean): StripCommentsResult {
  let source = "";
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (isInsideBlockComment) {
      if (char === "*" && next === "/") {
        isInsideBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote !== undefined) {
      source += char;
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === "/" && next === "/") {
      break;
    }

    if (char === "/" && next === "*") {
      isInsideBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
    }

    source += char;
  }

  return {
    isInsideBlockComment,
    source,
  };
}
