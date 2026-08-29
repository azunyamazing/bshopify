/**
 * Line-level source editing helpers for reconciling generated config files
 * without clobbering user formatting. Kept in their own module so the merge
 * logic stays small and reusable.
 */

export function replaceTopLevelConfigProperty(
  source: string,
  propertyName: string,
  propertySource: string,
): string {
  const lines = source.split(/\r?\n/);
  const propertyPattern = new RegExp(
    `^\\s*(?:["']${escapeRegExp(propertyName)}["']|${escapeRegExp(propertyName)})\\s*:`,
  );
  let scanDepth = 0;
  let isInsideBlockComment = false;
  let startIndex = -1;
  let endIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    const lineWithoutComments = stripComments(line, isInsideBlockComment);
    isInsideBlockComment = lineWithoutComments.isInsideBlockComment;

    if (scanDepth === 0 && propertyPattern.test(lineWithoutComments.source)) {
      startIndex = index;
      let propertyDepth = countBraceDelta(lineWithoutComments.source);

      if (propertyDepth <= 0) {
        endIndex = index;
        break;
      }

      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const cursorLine = lines[cursor];
        if (cursorLine === undefined) {
          continue;
        }

        const cursorLineWithoutComments = stripComments(cursorLine, isInsideBlockComment);
        isInsideBlockComment = cursorLineWithoutComments.isInsideBlockComment;
        propertyDepth += countBraceDelta(cursorLineWithoutComments.source);

        if (propertyDepth <= 0) {
          endIndex = cursor;
          break;
        }
      }
      break;
    }

    scanDepth = Math.max(0, scanDepth + countBraceDelta(lineWithoutComments.source));
  }

  if (startIndex === -1 || endIndex === -1) {
    return source;
  }

  return [
    ...lines.slice(0, startIndex),
    ...propertySource.split(/\r?\n/),
    ...lines.slice(endIndex + 1),
  ].join("\n");
}

export function hasTopLevelConfigProperty(source: string, propertyName: string): boolean {
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
