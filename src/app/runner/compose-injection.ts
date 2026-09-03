import { createFileMarker, createRestoreMarker, restoreMarkerPrefix } from "#/utils/markers";
import { findInjectionContext, getInjectionSyntax } from "#/utils/string-context";

export interface ComposedInjection {
  content: string;
  marker: string | undefined;
}

/**
 * Replaces the single occurrence of `pattern` in `source` with `value`,
 * appending the restore-marker comment when `restoreMarkers` is enabled.
 *
 * When the placeholder sits inside a quoted string literal (or inside a
 * Liquid `{{ ... }}` / `{% ... %}` unit, which cannot contain comments),
 * appending the comment right after the value would make it part of the
 * string's runtime value. The comment is placed after the enclosing
 * string/unit instead, and the marker records the length of the untouched
 * gap in between so the restore still finds the value from the marker alone.
 *
 * TOML comments are line comments: a marker mid-line would swallow the rest
 * of the line (e.g. a trailing comma in an array), so for `.toml` files the
 * marker is moved to the end of the line (before any marker already there)
 * and everything up to that point is recorded as the gap.
 */
export function composeInjection(
  source: string,
  targetPath: string,
  pattern: string,
  value: string,
  restoreMarkers: boolean,
): ComposedInjection {
  const matchIndex = source.indexOf(pattern);
  const valueEnd = matchIndex + pattern.length;

  if (!restoreMarkers) {
    return {
      content: source.slice(0, matchIndex) + value + source.slice(valueEnd),
      marker: undefined,
    };
  }

  const syntax = getInjectionSyntax(targetPath);
  const context = findInjectionContext(source, matchIndex, syntax);
  const insertAt =
    syntax === "toml" ? endOfLine(source, context?.insertAt ?? valueEnd) : (context?.insertAt ?? valueEnd);
  const gap = source.slice(valueEnd, insertAt);
  const marker = createFileMarker(targetPath, createRestoreMarker(pattern, value, gap));

  return {
    content: source.slice(0, matchIndex) + value + gap + marker + source.slice(insertAt),
    marker,
  };
}

/**
 * Index where a TOML marker may be inserted: the end of the line containing
 * `from`, because a `#` comment would otherwise swallow the rest of its
 * line (e.g. a trailing comma in an array). When restore markers already
 * sit on that line, the insertion stops before the leftmost one, so markers
 * written later land to the left of earlier ones and restore left-to-right.
 * A trailing `\r` stays ahead of the marker so CRLF files stay CRLF.
 */
function endOfLine(content: string, from: number): number {
  const newline = content.indexOf("\n", from);
  const lineEnd = newline === -1 ? content.length : newline;
  const line = content.slice(from, lineEnd);
  const markerStart = line.indexOf(` # ${restoreMarkerPrefix}:`);

  if (markerStart !== -1) {
    return from + markerStart;
  }

  return lineEnd > from && content[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
}
