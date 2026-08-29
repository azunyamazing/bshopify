import { createFileMarker, createRestoreMarker } from "#/utils/markers";
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

  const context = findInjectionContext(source, matchIndex, getInjectionSyntax(targetPath));
  const gap = context === undefined ? "" : source.slice(valueEnd, context.insertAt);
  const marker = createFileMarker(targetPath, createRestoreMarker(pattern, value, gap));

  if (context === undefined) {
    return {
      content: source.slice(0, matchIndex) + value + marker + source.slice(valueEnd),
      marker,
    };
  }

  return {
    content: source.slice(0, matchIndex) + value + gap + marker + source.slice(context.insertAt),
    marker,
  };
}
