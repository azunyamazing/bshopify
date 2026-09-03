import { extname } from "node:path";

/**
 * String-context detection for placeholder injection.
 *
 * When a placeholder sits inside a quoted string literal, appending the
 * restore-marker comment right after the injected value would make the
 * comment part of the string's runtime value (e.g. `value: "__URL__"` would
 * become `value: "https://x.com/* bshopify-restore:... *\/"`). The marker is
 * placed after the closing delimiter (or after a whole Liquid `{{ }}` /
 * `{% %}` unit, which cannot contain comments) and the gap in between is
 * recorded. Scans skip comments; only quotes in code files, inside HTML/JSX
 * tags and inside Liquid/HTML quoted units are treated as strings.
 */

export type InjectionSyntax = "code" | "markup" | "toml";

/** html/liquid need tag/text awareness; toml scans with `#` comments. */
export function getInjectionSyntax(path: string): InjectionSyntax {
  switch (extname(path).toLowerCase()) {
    case ".html":
    case ".htm":
    case ".liquid":
      return "markup";
    case ".toml":
      return "toml";
    default:
      return "code";
  }
}

export interface InjectionContext {
  /** Opening delimiter of the enclosing string or Liquid unit. */
  start: number;
  /** Index just past the closing delimiter. */
  end: number;
  /** Index where the marker comment may be inserted. */
  insertAt: number;
}

/** Context containing `matchStart`, or undefined when inline placement is safe. */
export function findInjectionContext(
  content: string,
  matchStart: number,
  syntax: InjectionSyntax,
): InjectionContext | undefined {
  const strings: Array<{ start: number; end: number }> = [];
  const liquids: Array<{ start: number; end: number }> = [];

  if (syntax === "markup") {
    scanMarkup(content, strings, liquids);
  } else {
    scanStrings(content, 0, content.length, strings, syntax === "toml");
  }

  // Inside a Liquid unit the marker goes after the whole unit: comments
  // are not allowed inside `{{ }}`/`{% %}`.
  for (const unit of liquids) {
    if (matchStart >= unit.start && matchStart < unit.end) {
      return { start: unit.start, end: unit.end, insertAt: unit.end };
    }
  }

  for (const string of strings) {
    if (matchStart > string.start && matchStart < string.end) {
      return { start: string.start, end: string.end, insertAt: string.end };
    }
  }

  return undefined;
}

interface StringRange {
  start: number;
  end: number;
}

function scanMarkup(
  content: string,
  strings: StringRange[],
  liquids: Array<{ start: number; end: number }>,
): void {
  const n = content.length;
  let i = 0;
  let inTag = false;

  while (i < n) {
    const ch = content[i];

    if (ch === "/" && content[i + 1] === "/") {
      i = skipLine(content, i + 2);
    } else if (ch === "/" && content[i + 1] === "*") {
      i = skipBlock(content, i + 2);
    } else if (ch === "<" && content.startsWith("<!--", i)) {
      i = skipHtmlComment(content, i + 4);
    } else if (ch === "{" && content.startsWith("{% comment %}", i)) {
      i = skipLiquidComment(content, i);
    } else if (ch === "{" && content.startsWith("{% schema %}", i)) {
      // Schema JSON body: scan as code so string defaults are recognized.
      const endschema = content.indexOf("{% endschema %}", i);
      const bodyEnd = endschema === -1 ? n : endschema;
      scanStrings(content, i + "{% schema %}".length, bodyEnd, strings);
      i = bodyEnd;
    } else if (content.startsWith("{{", i) || content.startsWith("{%", i)) {
      const end = findLiquidUnitEnd(content, i);
      liquids.push({ start: i, end });
      i = end;
    } else if (ch === "<") {
      inTag = true;
      i += 1;
    } else if (inTag && ch === ">") {
      inTag = false;
      i += 1;
    } else if (inTag && (ch === '"' || ch === "'")) {
      const end = findQuotedEnd(content, i, ch);
      strings.push({ start: i, end });
      i = end;
    } else {
      i += 1;
    }
  }
}

/** Records quoted strings, skipping comments (and `#` lines for toml). */
function scanStrings(
  content: string,
  from: number,
  to: number,
  strings: StringRange[],
  hashComments = false,
): void {
  let i = from;

  while (i < to) {
    const ch = content[i];

    if (hashComments && ch === "#") {
      i = skipLine(content, i + 1);
    } else if (ch === "/" && content[i + 1] === "/") {
      i = skipLine(content, i + 2);
    } else if (ch === "/" && content[i + 1] === "*") {
      i = skipBlock(content, i + 2);
    } else if (ch === '"' || ch === "'") {
      const end = findQuotedEnd(content, i, ch);
      if (end < content.length) {
        strings.push({ start: i, end });
      }
      i = end;
    } else if (ch === "`") {
      const end = findTemplateEnd(content, i);
      if (end < content.length) {
        strings.push({ start: i, end });
      }
      i = end;
    } else {
      i += 1;
    }
  }
}

function findQuotedEnd(content: string, start: number, quote: string): number {
  let i = start + 1;

  while (i < content.length) {
    const ch = content[i];

    if (ch === "\\") {
      i += 2;
    } else if (ch === quote) {
      return i + 1;
    } else {
      i += 1;
    }
  }

  return content.length;
}

function findTemplateEnd(content: string, start: number): number {
  let i = start + 1;
  let interpolationDepth = 0;

  while (i < content.length) {
    const ch = content[i];

    if (ch === "\\") {
      i += 2;
    } else if (ch === "`") {
      if (interpolationDepth === 0) {
        return i + 1;
      }
      i = findTemplateEnd(content, i);
    } else if (ch === "$" && content[i + 1] === "{") {
      interpolationDepth += 1;
      i += 2;
    } else if (ch === "}" && interpolationDepth > 0) {
      interpolationDepth -= 1;
      i += 1;
    } else if ((ch === '"' || ch === "'") && interpolationDepth > 0) {
      i = findQuotedEnd(content, i, ch);
    } else {
      i += 1;
    }
  }

  return content.length;
}

function findLiquidUnitEnd(content: string, start: number): number {
  const closer = content.startsWith("{{", start) ? "}}" : "%}";
  let i = start + 2;

  while (i < content.length) {
    const ch = content[i];

    if (ch === "\\") {
      i += 2;
    } else if (ch === '"' || ch === "'") {
      i = findQuotedEnd(content, i, ch);
    } else if (content.startsWith(closer, i)) {
      return i + closer.length;
    } else {
      i += 1;
    }
  }

  return content.length;
}

function skipLine(content: string, from: number): number {
  const idx = content.indexOf("\n", from);
  return idx === -1 ? content.length : idx + 1;
}

function skipBlock(content: string, from: number): number {
  const idx = content.indexOf("*/", from);
  return idx === -1 ? content.length : idx + 2;
}

function skipHtmlComment(content: string, from: number): number {
  const idx = content.indexOf("-->", from);
  return idx === -1 ? content.length : idx + 3;
}

function skipLiquidComment(content: string, from: number): number {
  const idx = content.indexOf("{% endcomment %}", from);
  return idx === -1 ? content.length : idx + "{% endcomment %}".length;
}
