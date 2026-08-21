import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findRestoreMarkers,
  hasRestoreMarkers,
  restoreInjectedMarkers,
} from "../src/app/runner/restore-markers";
import {
  createFileMarker,
  createRestoreMarker,
  createValueChecksum,
  encodeBase64Url,
} from "../src/utils/markers";
import {
  createFileTransaction,
  restoreFileTransactionJournal,
} from "../src/app/runner/transaction";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

/**
 * Mirrors how applyInjections composes the injected file content:
 * `source.replace(pattern, value + createFileMarker(path, createRestoreMarker(...)))`.
 */
function inject(source: string, filePath: string, pattern: string, value: string): string {
  const marker = createFileMarker(filePath, createRestoreMarker(pattern, value));
  return source.replace(pattern, `${value}${marker}`);
}

describe("createRestoreMarker", () => {
  it("embeds the pattern, the value length, and a value checksum", () => {
    const marker = createRestoreMarker("__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com");

    expect(marker.startsWith("bshopify-restore:")).toBe(true);
    expect(marker).toContain(encodeBase64Url("__SHOPIFY_APP_PROXY_BASE__"));
    expect(marker).toContain(":25:");
    expect(marker).toContain(`:${createValueChecksum("https://proxy.example.com")}:`);
    expect(marker).toMatch(/:[0-9a-f]{16}:/);
    expect(marker).toMatch(/:[0-9a-f-]{36}$/);
  });

  it("encodes patterns that would otherwise break comment syntax", () => {
    const marker = createRestoreMarker("*/__WEIRD__", "x");
    expect(marker).not.toContain("*/__WEIRD__");
    expect(restoreInjectedMarkers(`const a = "x${createFileMarker("a.js", marker)}";`)).toBe(
      'const a = "*/__WEIRD__";',
    );
  });

  it("round-trips emoji values (UTF-16 surrogate pairs)", () => {
    const filePath = "extensions/x/__entry.js";
    const source = 'const url = "__APP_URL__";\n';
    const injected = inject(source, filePath, "__APP_URL__", "https://例.com/😀");

    expect(restoreInjectedMarkers(injected)).toBe(source);
  });
});

describe("restoreInjectedMarkers", () => {
  const cases: Array<[string, string, string, string, string]> = [
    [
      "block comment syntax (js)",
      "extensions/x/__entry.js",
      'const proxyBase = "__SHOPIFY_APP_PROXY_BASE__";\n',
      "__SHOPIFY_APP_PROXY_BASE__",
      "https://proxy.example.com",
    ],
    [
      "liquid comment syntax",
      "extensions/x/blocks/app-embed.liquid",
      '{% assign base = "__SHOPIFY_APP_PROXY_BASE__" %}\n',
      "__SHOPIFY_APP_PROXY_BASE__",
      "https://proxy.example.com/app?x=1&y=2",
    ],
    [
      "html comment syntax",
      "extensions/x/blocks/embed.html",
      '<a href="__APP_URL__">go</a>\n',
      "__APP_URL__",
      "https://example.com",
    ],
    [
      "jsx comment syntax",
      "extensions/x/blocks/App.jsx",
      'const url = "__APP_URL__";\n',
      "__APP_URL__",
      "https://example.com",
    ],
    [
      "unicode pattern and value",
      "extensions/x/blocks/embed.liquid",
      "{{ '__代理__' }}\n",
      "__代理__",
      "https://例.com",
    ],
  ];

  it.each(cases)("%s", (_label, filePath, source, pattern, value) => {
    const injected = inject(source, filePath, pattern, value);

    expect(hasRestoreMarkers(injected)).toBe(true);
    expect(restoreInjectedMarkers(injected)).toBe(source);
  });

  it("restores multiple injections in the same file", () => {
    const filePath = "extensions/x/blocks/app-embed.liquid";
    const source = [
      '{{ "__PROXY_BASE__" }}',
      "|",
      '{{ "__APP_URL__" }}',
      "\n",
    ].join("");
    const first = inject(source, filePath, "__PROXY_BASE__", "https://proxy.example.com");
    const injected = inject(first, filePath, "__APP_URL__", "https://example.com");

    expect(restoreInjectedMarkers(injected)).toBe(source);
  });

  it("leaves content without markers untouched", () => {
    const source = "const x = 1;\n";

    expect(hasRestoreMarkers(source)).toBe(false);
    expect(restoreInjectedMarkers(source)).toBe(source);
  });

  it("skips malformed markers whose value length overruns the file", () => {
    const filePath = "extensions/x/__entry.js";
    const source = 'const url = "__APP_URL__";\n';
    const injected = inject(source, filePath, "__APP_URL__", "https://example.com");
    const broken = injected.replace(
      /bshopify-restore:([A-Za-z0-9_-]+):(\d+)/,
      "bshopify-restore:$1:1000",
    );

    expect(restoreInjectedMarkers(broken)).toBe(broken);
  });

  it("ignores marker-like text inside injected values", () => {
    const filePath = "extensions/x/__entry.js";
    const source = 'const url = "__APP_URL__";\n';
    const fakeMarkerInsideValue = "https://x.com/* bshopify-restore:YWJj:1:aaaa */tail";
    const injected = inject(source, filePath, "__APP_URL__", fakeMarkerInsideValue);

    expect(restoreInjectedMarkers(injected)).toBe(source);
  });

  it("leaves marker-like text outside any injected value untouched", () => {
    const filePath = "extensions/x/__entry.js";
    const plain = [
      "// user comment mentioning the format",
      "// /* bshopify-restore:YWJj:1:aaaaaaaaaaaaaaaa:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb */",
      "const x = 1;\n",
    ].join("\n");

    expect(restoreInjectedMarkers(plain)).toBe(plain);
  });

  it("skips a marker whose recorded value was edited mid-dev", () => {
    const filePath = "extensions/x/blocks/app-embed.liquid";
    const injected = inject(
      '{{ "__SHOPIFY_APP_PROXY_BASE__" }}\n',
      filePath,
      "__SHOPIFY_APP_PROXY_BASE__",
      "https://proxy.example.com",
    );
    // Simulate a developer editing the temporary injected value (different
    // length): restore must not misalign and corrupt the file.
    const edited = injected.replace(
      "https://proxy.example.com",
      "https://proxy.example.com/edited-path",
    );

    expect(restoreInjectedMarkers(edited)).toBe(edited);
  });

  it("reports a single marker for jsx comment wrappers", () => {
    const filePath = "extensions/x/App.jsx";
    const source = 'const url = "__APP_URL__";\n';
    const injected = inject(source, filePath, "__APP_URL__", "https://example.com");

    expect(findRestoreMarkers(injected)).toHaveLength(1);
    expect(restoreInjectedMarkers(injected)).toBe(source);
  });

  it("finds markers in document order with exact positions", () => {
    const filePath = "extensions/x/__entry.js";
    const injected = inject(
      'const a = "__A__";\nconst b = "__B__";\n',
      filePath,
      "__A__",
      "aaa",
    ).replace("__B__", `bbb${createFileMarker(filePath, createRestoreMarker("__B__", "bbb"))}`);
    const markers = findRestoreMarkers(injected);

    expect(markers).toHaveLength(2);
    expect(markers[0]?.pattern).toBe("__A__");
    expect(markers[1]?.pattern).toBe("__B__");
    expect(markers[0]!.fullStart).toBeLessThan(markers[1]!.fullStart);
  });
});

describe("transaction restore", () => {
  it("restores marker injections when the journal records no mapping", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bshopify-restore-"));
    tempDirs.push(cwd);
    const filePath = join(cwd, "blocks", "app-embed.liquid");
    await mkdir(join(cwd, "blocks"), { recursive: true });
    const source = '{{ "__SHOPIFY_APP_PROXY_BASE__" }}\n';
    await writeFile(filePath, source);

    const journalPath = join(cwd, "transaction.json");
    const transaction = await createFileTransaction(journalPath);
    await transaction.writeFile(
      filePath,
      inject(source, filePath, "__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com"),
      {
        marker: createFileMarker(
          filePath,
          createRestoreMarker("__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com"),
        ),
        pattern: "__SHOPIFY_APP_PROXY_BASE__",
        value: "https://proxy.example.com",
      },
    );

    // Crash: the journal survives but its mapping section was lost. The file
    // list still points at the injected file; markers carry the restore data.
    await writeJournalWithReplacements(journalPath, filePath, []);
    const restored = await restoreFileTransactionJournal(journalPath);

    expect(restored).toBe(true);
    await expect(readFile(filePath, "utf8")).resolves.toBe(source);
  });

  it("recovers the placeholder even when the journal mapping is stale", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bshopify-stale-"));
    tempDirs.push(cwd);
    const filePath = join(cwd, "blocks", "app-embed.liquid");
    await mkdir(join(cwd, "blocks"), { recursive: true });
    const source = '{{ "__SHOPIFY_APP_PROXY_BASE__" }}\n';
    await writeFile(filePath, source);

    const journalPath = join(cwd, "transaction.json");
    const transaction = await createFileTransaction(journalPath);
    await transaction.writeFile(
      filePath,
      inject(source, filePath, "__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com"),
      {
        marker: createFileMarker(
          filePath,
          createRestoreMarker("__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com"),
        ),
        pattern: "__SHOPIFY_APP_PROXY_BASE__",
        value: "https://proxy.example.com",
      },
    );

    // Simulate a stale journal: the recorded mapping no longer matches the
    // injected file, but the marker in the file still carries the truth.
    await writeJournalWithReplacements(journalPath, filePath, [
      {
        marker: "/* stale */",
        pattern: "__WRONG__",
        value: "stale-value",
      },
    ]);
    const restored = await restoreFileTransactionJournal(journalPath);

    expect(restored).toBe(true);
    await expect(readFile(filePath, "utf8")).resolves.toBe(source);
  });
});

async function writeJournalWithReplacements(
  journalPath: string,
  filePath: string,
  replacements: unknown[],
): Promise<void> {
  await writeFile(
    journalPath,
    `${JSON.stringify(
      {
        files: [
          {
            path: filePath,
            replacements,
          },
        ],
        hiddenFiles: [],
      },
      undefined,
      2,
    )}\n`,
  );
}
