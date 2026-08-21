import { isAbsolute, join, relative, sep } from "node:path";

export function normalizePathPart(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

export function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

export function formatPath(cwd: string, path: string): string {
  const relativePath = relative(cwd, path);

  if (relativePath.length > 0 && !relativePath.startsWith("..")) {
    return toPosixPath(relativePath);
  }

  return toPosixPath(path);
}

export function isInsidePath(root: string, path: string): boolean {
  const relativePath = relative(root, path);

  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

export function resolvePath(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}
