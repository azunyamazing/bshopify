import { ansi, colorize } from "#/utils/output";

interface FormattableCheck {
  message: string;
  name: string;
  ok: boolean;
}

export function formatChecks(checks: FormattableCheck[]): string[] {
  if (checks.length === 0) {
    return [];
  }

  return [
    "",
    colorize(colorize("Checks", ansi.blue), ansi.bold),
    ...checks.map(
      (check) =>
        `  ${colorize(check.ok ? "ok" : "missing", check.ok ? ansi.green : ansi.red)} ${check.name}`,
    ),
  ];
}
