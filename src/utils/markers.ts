import { extname } from "node:path";

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
