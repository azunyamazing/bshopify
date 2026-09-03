import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultRunnerConfig } from "../src/app/runner/config";
import {
  findManagedEntries,
  formatSkippedPlaceholderEntries,
  loadManagedEntryHooks,
} from "../src/extension/entries";
import { managedEntryTemplate } from "../src/extension/manage-content";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function createFixtureProject(entries: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "bshopify-entries-"));
  tempDirs.push(cwd);

  await writeFile(join(cwd, "package.json"), `${JSON.stringify({ name: "fixture" })}\n`);

  for (const [extensionName, content] of Object.entries(entries)) {
    const extensionRoot = join(cwd, "extensions", extensionName);
    await mkdir(extensionRoot, { recursive: true });
    await writeFile(join(extensionRoot, "__entry.js"), content);
  }

  return cwd;
}

async function discoverEntries(cwd: string) {
  return findManagedEntries(cwd, {
    entryFileName: defaultRunnerConfig.entryFileName,
    extensionsRoot: defaultRunnerConfig.extensionsRoot,
  });
}

describe("loadManagedEntryHooks", () => {
  it("skips untouched generated placeholders when skipPlaceholders is enabled", async () => {
    const cwd = await createFixtureProject({
      "placeholder-a": managedEntryTemplate,
      "custom-b": "export default { prepare() { return { injections: [] }; } };\n",
    });
    const entries = await discoverEntries(cwd);

    const hooks = await loadManagedEntryHooks(entries, { skipPlaceholders: true });

    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.extension).toBe("custom-b");
  });

  it("loads every entry when skipPlaceholders is not enabled", async () => {
    const cwd = await createFixtureProject({
      "placeholder-a": managedEntryTemplate,
      "custom-b": "export default { prepare() { return { injections: [] }; } };\n",
    });
    const entries = await discoverEntries(cwd);

    const hooks = await loadManagedEntryHooks(entries);

    expect(hooks).toHaveLength(2);
  });

  it("still validates custom entries that only differ from the template", async () => {
    const cwd = await createFixtureProject({
      "custom-b": "export default { custom: true };\n",
    });
    const entries = await discoverEntries(cwd);

    await expect(
      loadManagedEntryHooks(entries, { skipPlaceholders: true }),
    ).rejects.toThrow("must export a lifecycle object with prepare(ctx)");
  });
});

describe("formatSkippedPlaceholderEntries", () => {
  it("returns undefined when nothing was skipped", () => {
    expect(formatSkippedPlaceholderEntries(0)).toBeUndefined();
  });

  it("uses singular wording for a single skipped entry", () => {
    expect(formatSkippedPlaceholderEntries(1)).toContain("1 placeholder extension entry");
    expect(formatSkippedPlaceholderEntries(1)).not.toContain("entries");
  });

  it("uses plural wording for multiple skipped entries", () => {
    expect(formatSkippedPlaceholderEntries(3)).toContain("3 placeholder extension entries");
  });
});
