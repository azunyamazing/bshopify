import { createValueChecksum, decodeBase64Url, restoreMarkerPrefix } from "#/utils/markers";

/**
 * Restore-marker parsing shared by the dev transaction restore and the
 * generated git clean filter. Both must agree on the marker format so a file
 * restored by one is understood by the other.
 *
 * Injected files contain `value` immediately followed by a marker comment
 * whose core is
 * `bshopify-restore:<b64url(pattern)>:<valueLength>:<checksum>:<nonce>`,
 * wrapped in the file-type comment syntax (block, html, jsx, or liquid).
 *
 * `valueLength` is the UTF-16 length of the injected value and `checksum`
 * hashes it, so the value can be recovered from the file content alone and a
 * marker is only trusted when the preceding text actually verifies.
 */

export interface RestoreMarker {
  /** Index of the first character of the marker comment. */
  fullStart: number;
  /** Index just past the end of the marker comment. */
  fullEnd: number;
  /** Length of the injected value that precedes the marker. */
  valueLength: number;
  /** Checksum of the injected value that precedes the marker. */
  checksum: string;
  /** The placeholder pattern to restore. */
  pattern: string;
}

const markerCorePattern =
  "bshopify-restore:([A-Za-z0-9_-]+):(\\d+):([0-9a-fA-F]{16}):([0-9a-fA-F-]+)";

const markerPatterns = [
  new RegExp(`/\\* ${markerCorePattern} \\*/`, "g"),
  new RegExp(`<!-- ${markerCorePattern} -->`, "g"),
  new RegExp(`\\{/\\* ${markerCorePattern} \\*/\\}`, "g"),
  new RegExp(`\\{% comment %} ${markerCorePattern} \\{% endcomment %\\}`, "g"),
];

/** Finds every restore marker in the content, in document order. */
export function findRestoreMarkers(content: string): RestoreMarker[] {
  const markers: RestoreMarker[] = [];

  for (const pattern of markerPatterns) {
    pattern.lastIndex = 0;

    for (const match of content.matchAll(pattern)) {
      const fullStart = match.index ?? 0;

      markers.push({
        checksum: match[3] ?? "",
        fullEnd: fullStart + match[0].length,
        fullStart,
        pattern: decodeBase64Url(match[1] ?? ""),
        valueLength: Number(match[2] ?? "0"),
      });
    }
  }

  // Drop markers fully contained inside another marker's comment. The jsx
  // syntax `{/* ... */}` also matches the block regex on its inner part, so
  // without this a jsx marker would be reported twice.
  const sorted = markers.sort((left, right) => left.fullStart - right.fullStart);
  const unique: RestoreMarker[] = [];
  let lastFullEnd = 0;

  for (const marker of sorted) {
    if (marker.fullStart >= lastFullEnd) {
      unique.push(marker);
      lastFullEnd = marker.fullEnd;
    }
  }

  return unique;
}

/** Returns true when the content contains at least one restore marker. */
export function hasRestoreMarkers(content: string): boolean {
  return content.includes(`${restoreMarkerPrefix}:`);
}

/**
 * Reverses every injection recorded in the content, restoring placeholders.
 *
 * Markers are processed right-to-left so earlier positions stay valid as
 * later regions shrink or grow. A marker is skipped when its value length
 * reaches before the file start, when the marker itself sits inside a region
 * already replaced by a marker to its right (marker-like text inside an
 * injected value), or when the preceding text does not hash to the recorded
 * checksum (marker-like text in user content, or an edited value). Skipped
 * markers are left untouched.
 */
export function restoreInjectedMarkers(content: string): string {
  const markers = findRestoreMarkers(content);

  if (markers.length === 0 || content.includes("\u0000")) {
    return content;
  }

  let result = content;
  let consumedFrom = content.length;

  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const marker = markers[index];

    if (marker === undefined) {
      continue;
    }

    // The marker lies inside a region already replaced by a marker to its
    // right (e.g. marker-like text inside an injected value): skip it.
    if (marker.fullStart >= consumedFrom) {
      continue;
    }

    const valueStart = marker.fullStart - marker.valueLength;

    if (valueStart < 0) {
      continue;
    }

    if (createValueChecksum(content.slice(valueStart, marker.fullStart)) !== marker.checksum) {
      continue;
    }

    result =
      result.slice(0, valueStart)
      + marker.pattern
      + result.slice(marker.fullEnd);
    consumedFrom = valueStart;
  }

  return result;
}
