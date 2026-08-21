import { randomUUID } from "node:crypto";
import { extname } from "node:path";

/**
 * Marker prefix for temporary injection restores.
 *
 * The marker embeds everything a restore needs without external state:
 * the placeholder pattern (base64url-encoded so it can never break the
 * surrounding comment syntax) and the length of the injected value that
 * immediately precedes the marker. Git clean filters and crash recovery
 * both rely on this self-describing form.
 */
export const restoreMarkerPrefix = "bshopify-restore";

/**
 * Creates the self-describing restore marker core for an injection.
 *
 * Injected files contain `value` immediately followed by the marker comment,
 * so the marker records enough to reverse the replacement from the file
 * content alone:
 * `bshopify-restore:<b64url(pattern)>:<valueLength>:<checksum>:<nonce>`.
 * The checksum is over the injected value: restore only trusts the recorded
 * value length when the preceding text actually hashes to it, so marker-like
 * text in user content and hand-edited values are never "restored" into
 * garbage.
 */
export function createRestoreMarker(
  pattern: string,
  value: string,
  nonce: string = randomUUID(),
): string {
  return `${restoreMarkerPrefix}:${encodeBase64Url(pattern)}:${value.length}:${createValueChecksum(value)}:${nonce}`;
}

export function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

/**
 * 64-bit FNV-1a-style checksum over UTF-16 code units.
 *
 * Deliberately dependency-free and identical in the generated git filter
 * script: the marker format must be verifiable without any import, which
 * keeps the script valid as both CommonJS and ESM. Collision resistance is
 * only needed against accidental marker-shaped text, not adversaries.
 */
export function createValueChecksum(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let index = 0; index < value.length; index += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * prime);
  }

  return hash.toString(16).padStart(16, "0");
}

export function createFileMarker(path: string, marker: string): string {
  switch (getMarkerSyntax(path)) {
    case "liquid":
      return `{% comment %} ${marker} {% endcomment %}`;
    case "html":
      return `<!-- ${marker} -->`;
    case "jsx":
      return `{/* ${marker} */}`;
    case "block":
      return `/* ${marker} */`;
  }
}

type MarkerSyntax = "block" | "html" | "jsx" | "liquid";

function getMarkerSyntax(path: string): MarkerSyntax {
  switch (extname(path).toLowerCase()) {
    case ".liquid":
      return "liquid";
    case ".html":
    case ".htm":
      return "html";
    case ".jsx":
    case ".tsx":
      return "jsx";
    case ".css":
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".ts":
    case ".mts":
    case ".cts":
    case ".scss":
    case ".sass":
    case ".less":
      return "block";
    default:
      return "block";
  }
}
