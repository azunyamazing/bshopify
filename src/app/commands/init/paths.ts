import { formatPath, resolvePath } from "#/utils/paths";

export function toDisplayPath(cwd: string, absolutePath: string): string {
  return formatPath(cwd, absolutePath);
}

export function resolveProjectPath(cwd: string, path: string): string {
  return resolvePath(cwd, path);
}
