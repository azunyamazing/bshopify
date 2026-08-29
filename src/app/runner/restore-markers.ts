import { createValueChecksum, decodeBase64Url, restoreMarkerPrefix } from "#/utils/markers";

/**
 * Restore-marker parsing shared by the dev transaction restore and the
 * generated git clean filter. Both must agree on the marker format so a file
 * restored by one is understood by the other.
 *
 * Injected files contain `value` followed by a marker comment whose core is
 * `bshopify-restore:<b64url(pattern)>:<valueLength>:<gapLength>:<checksum>:<nonce>`,
 * wrapped in the file-type comment syntax (block, html, jsx, or liquid).
 * `gapLength` is zero when the marker sits flush after the value (plain code
 * position) and positive when the marker had to be moved outside a string
 * literal or Liquid unit, leaving the untouched source text between the
 * value and the comment. Markers written by older versions (no gapLength)
 * are parsed with an implicit gap of zero.
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
  /** Length of the untouched gap between the value and the marker. */
  gapLength: number;
  /** Checksum of the injected value that precedes the marker. */
  checksum: string;
  /** The placeholder pattern to restore. */
  pattern: string;
}

const markerCorePattern =
  "bshopify-restore:([A-Za-z0-9_-]+):(\\d+):(\\d+):([0-9a-fA-F]{16}):([0-9a-fA-F-]+)";
const legacyMarkerCorePattern =
  "bshopify-restore:([A-Za-z0-9_-]+):(\\d+):([0-9a-fA-F]{16}):([0-9a-fA-F-]+)";

interface MarkerFormat {
  patterns: RegExp[];
  legacy: boolean;
}

const markerFormats: MarkerFormat[] = [
  {
    legacy: false,
    patterns: [
      new RegExp(`/\\* ${markerCorePattern} \\*/`, "g"),
      new RegExp(`<!-- ${markerCorePattern} -->`, "g"),
      new RegExp(`\\{/\\* ${markerCorePattern} \\*/\\}`, "g"),
      new RegExp(`\\{% comment %} ${markerCorePattern} \\{% endcomment %\\}`, "g"),
    ],
  },
  {
    legacy: true,
    patterns: [
      new RegExp(`/\\* ${legacyMarkerCorePattern} \\*/`, "g"),
      new RegExp(`<!-- ${legacyMarkerCorePattern} -->`, "g"),
      new RegExp(`\\{/\\* ${legacyMarkerCorePattern} \\*/\\}`, "g"),
      new RegExp(`\\{% comment %} ${legacyMarkerCorePattern} \\{% endcomment %\\}`, "g"),
    ],
  },
];

/** Finds every restore marker in the content, in document order. */
export function findRestoreMarkers(content: string): RestoreMarker[] {
  const markers: RestoreMarker[] = [];

  for (const format of markerFormats) {
    for (const pattern of format.patterns) {
      pattern.lastIndex = 0;

      for (const match of content.matchAll(pattern)) {
        const fullStart = match.index ?? 0;

        markers.push({
          checksum: format.legacy ? (match[3] ?? "") : (match[4] ?? ""),
          fullEnd: fullStart + match[0].length,
          fullStart,
          gapLength: format.legacy ? 0 : Number(match[3] ?? "0"),
          pattern: decodeBase64Url(match[1] ?? ""),
          valueLength: Number(match[2] ?? "0"),
        });
      }
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
 * Markers are processed left-to-right, and each marker's positions are
 * shifted by the cumulative delta of the regions already restored to its
 * left, so injections whose markers end up inside another marker's gap
 * (multiple placeholders in one string literal) are restored in the right
 * order. A marker is skipped when its value length reaches before the file
 * start or when the preceding text does not hash to the recorded checksum
 * (marker-like text in user content, or an edited value). Skipped markers
 * are left untouched.
 */
export function restoreInjectedMarkers(content: string): string {
  const markers = findRestoreMarkers(content);

  if (markers.length === 0 || content.includes("\u0000")) {
    return content;
  }

  let result = content;
  const consumed: Array<{ end: number; delta: number }> = [];

  for (const marker of markers) {
    // Cumulative shift of every region already restored to the left of this
    // marker (in original coordinates).
    let deltaBefore = 0;
    for (const region of consumed) {
      if (region.end <= marker.fullStart) {
        deltaBefore += region.delta;
      }
    }

    const fullStart = marker.fullStart + deltaBefore;
    const fullEnd = marker.fullEnd + deltaBefore;
    const valueStart = fullStart - marker.valueLength - marker.gapLength;

    if (valueStart < 0) {
      continue;
    }

    const valueEnd = valueStart + marker.valueLength;

    if (createValueChecksum(result.slice(valueStart, valueEnd)) !== marker.checksum) {
      continue;
    }

    result =
      result.slice(0, valueStart)
      + marker.pattern
      + result.slice(valueEnd, fullStart)
      + result.slice(fullEnd);
    consumed.push({
      end: marker.fullEnd,
      delta: marker.pattern.length - marker.valueLength - (marker.fullEnd - marker.fullStart),
    });
  }

  return result;
}
