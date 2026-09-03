import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanFilterScript } from "../src/app/commands/init/constants";
import { restoreInjectedMarkers } from "../src/app/runner/restore-markers";
import { composeInjection } from "../src/app/runner/compose-injection";
import { createFileMarker, createRestoreMarker } from "../src/utils/markers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

interface FilterResult {
  code: number | null;
  stderr: string;
  stdout: Buffer;
}

function runCleanFilter(
  scriptPath: string,
  input: string | Buffer,
  args: string[] = [],
): Promise<FilterResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...args]);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout),
      }),
    );
    child.stdin.end(input);
  });
}

/**
 * Mirrors how applyInjections composes the injected file content
 * (string-context-aware marker placement).
 */
function inject(source: string, filePath: string, pattern: string, value: string): string {
  return composeInjection(source, filePath, pattern, value, true).content;
}

async function writeCleanFilterScript(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "bshopify-filter-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, "scripts"), { recursive: true });
  const scriptPath = join(cwd, "scripts", "git-add-cleaner.js");
  await writeFile(scriptPath, cleanFilterScript);
  return scriptPath;
}

describe("generated git clean filter script", () => {
  it("restores injected liquid content to placeholders", async () => {
    const scriptPath = await writeCleanFilterScript();
    const filePath = "extensions/x/blocks/app-embed.liquid";
    const source = '{{ "__SHOPIFY_APP_PROXY_BASE__" }}\n';
    const injected = inject(source, filePath, "__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com");

    const result = await runCleanFilter(scriptPath, injected);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toEqual(Buffer.from(source));
  });

  it("restores injected javascript content to placeholders", async () => {
    const scriptPath = await writeCleanFilterScript();
    const filePath = "extensions/x/__entry.js";
    const source = 'const proxyBase = "__SHOPIFY_APP_PROXY_BASE__";\n';
    const injected = inject(source, filePath, "__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com");

    const result = await runCleanFilter(scriptPath, injected);

    expect(result.stdout).toEqual(Buffer.from(source));
  });

  it("restores injected toml content to placeholders", async () => {
    const scriptPath = await writeCleanFilterScript();
    const filePath = "shopify.app.dev.toml";
    const source = 'application_url = "__SHOPIFY_APP_PROXY_BASE__"\n';
    const injected = inject(source, filePath, "__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com");

    expect(injected).toContain(" # bshopify-restore:");

    const result = await runCleanFilter(scriptPath, injected);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toEqual(Buffer.from(source));
  });

  it("restores a string-context injection without corrupting the string value", async () => {
    const scriptPath = await writeCleanFilterScript();
    const filePath = "extensions/x/assets/app.js";
    const source = 'value: "REPLACE_WITH_CATALOG_API_URL",\n';
    const injected = inject(source, filePath, "REPLACE_WITH_CATALOG_API_URL", "Catalog API value");

    // The marker must never sit inside the string literal.
    expect(injected).toContain('value: "Catalog API value"/* bshopify-restore:');

    const result = await runCleanFilter(scriptPath, injected);

    expect(result.stdout).toEqual(Buffer.from(source));
  });

  it("restores multiple placeholders inside one string", async () => {
    const scriptPath = await writeCleanFilterScript();
    const filePath = "extensions/x/__entry.js";
    const source = 'value: "__A__ and __B__",\n';
    const first = inject(source, filePath, "__A__", "aaa");
    const injected = inject(first, filePath, "__B__", "bbb");

    const result = await runCleanFilter(scriptPath, injected);

    expect(result.stdout).toEqual(Buffer.from(source));
  });

  it("restores a placeholder inside a Liquid output unit", async () => {
    const scriptPath = await writeCleanFilterScript();
    const filePath = "extensions/x/blocks/app-embed.liquid";
    const source = '{{ "__SHOPIFY_APP_PROXY_BASE__" }}\n';
    const injected = inject(source, filePath, "__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com");

    expect(injected).toContain('{{ "https://proxy.example.com" }}{% comment %} bshopify-restore:');

    const result = await runCleanFilter(scriptPath, injected);

    expect(result.stdout).toEqual(Buffer.from(source));
  });

  it("restores a placeholder inside an HTML attribute value", async () => {
    const scriptPath = await writeCleanFilterScript();
    const filePath = "extensions/x/blocks/embed.html";
    const source = '<a href="__APP_URL__">go</a>\n';
    const injected = inject(source, filePath, "__APP_URL__", "https://example.com");

    const result = await runCleanFilter(scriptPath, injected);

    expect(result.stdout).toEqual(Buffer.from(source));
  });

  it("restores multiple injections in one file", async () => {
    const scriptPath = await writeCleanFilterScript();
    const filePath = "extensions/x/blocks/app-embed.liquid";
    const source = '{{ "__A__" }}|{{ "__B__" }}\n';
    const first = inject(source, filePath, "__A__", "aaa");
    const injected = inject(first, filePath, "__B__", "bbb");

    const result = await runCleanFilter(scriptPath, injected);

    expect(result.stdout).toEqual(Buffer.from(source));
  });

  it("passes plain files through byte-for-byte", async () => {
    const scriptPath = await writeCleanFilterScript();
    const plain = "const x = 1;\n// nothing to see here\n";

    const result = await runCleanFilter(scriptPath, plain);

    expect(result.stdout).toEqual(Buffer.from(plain));
  });

  it("passes binary-looking content through untouched", async () => {
    const scriptPath = await writeCleanFilterScript();
    const binary = Buffer.from(`\u0000\u0001PNG${"bshopify-restore:not-a-real-marker"}\u0000`, "utf8");

    const result = await runCleanFilter(scriptPath, binary);

    expect(result.stdout).toEqual(binary);
  });

  it("passes non-UTF-8 text through byte-for-byte", async () => {
    const scriptPath = await writeCleanFilterScript();
    // Latin-1 "café" (0xE9) must never be decoded and re-encoded.
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);

    const result = await runCleanFilter(scriptPath, latin1);

    expect(result.stdout).toEqual(latin1);
  });

  it("leaves marker-like text outside any injected value untouched", async () => {
    const scriptPath = await writeCleanFilterScript();
    const plain = [
      "// user comment mentioning the format",
      "// /* bshopify-restore:YWJj:1:aaaaaaaaaaaaaaaa:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb */",
      "const x = 1;\n",
    ].join("\n");

    const result = await runCleanFilter(scriptPath, plain);

    expect(result.stdout).toEqual(Buffer.from(plain));
  });

  it("acts as identity in smudge mode", async () => {
    const scriptPath = await writeCleanFilterScript();
    const filePath = "extensions/x/blocks/app-embed.liquid";
    const injected = inject(
      '{{ "__SHOPIFY_APP_PROXY_BASE__" }}\n',
      filePath,
      "__SHOPIFY_APP_PROXY_BASE__",
      "https://proxy.example.com",
    );

    const result = await runCleanFilter(scriptPath, injected, ["--smudge"]);

    expect(result.stdout).toEqual(Buffer.from(injected));
  });
});

describe("generated script parity with the TS restore", () => {
  const filePath = "extensions/x/blocks/app-embed.liquid";
  const cases: Array<[string, string]> = [
    [
      "liquid injected",
      inject('{{ "__SHOPIFY_APP_PROXY_BASE__" }}\n', filePath, "__SHOPIFY_APP_PROXY_BASE__", "https://proxy.example.com"),
    ],
    [
      "js injected",
      inject('const a = "__A__";\n', "extensions/x/__entry.js", "__A__", "https://example.com"),
    ],
    [
      "jsx injected",
      inject('const a = "__A__";\n', "extensions/x/B.jsx", "__A__", "https://example.com"),
    ],
    [
      "html injected",
      inject('<a href="__A__">x</a>\n', "extensions/x/b.html", "__A__", "https://example.com"),
    ],
    [
      "string-context js object",
      inject('value: "__A__",\n', "extensions/x/app.js", "__A__", "Catalog API value"),
    ],
    [
      "string-context mid-string",
      inject('const url = "https://x.com/__A__/y";\n', "extensions/x/app.js", "__A__", "products"),
    ],
    [
      "multiple placeholders in one string",
      inject(
        inject('value: "__A__ and __B__",\n', "extensions/x/app.js", "__A__", "aaa"),
        "extensions/x/app.js",
        "__B__",
        "bbb",
      ),
    ],
    [
      "liquid output unit",
      inject('{{ "__A__" }}\n', filePath, "__A__", "https://example.com"),
    ],
    [
      "liquid output unit unquoted",
      inject("{{ __A__ }}\n", filePath, "__A__", "https://example.com"),
    ],
    [
      "html attribute value",
      inject('<a href="__A__" class="x">go</a>\n', "extensions/x/b.html", "__A__", "https://example.com"),
    ],
    [
      "toml string injection",
      inject('application_url = "__A__"\n', "shopify.app.dev.toml", "__A__", "https://example.com"),
    ],
    [
      "toml bare value injection",
      inject("port = __A__\n", "shopify.app.toml", "__A__", "8080"),
    ],
    [
      "toml with trailing user comment",
      inject('name = "__A__" # keep me\n', "shopify.app.toml", "__A__", "prod"),
    ],
    [
      "toml multi-line array element with trailing comma",
      inject('scopes = [\n  "__A__",\n  "write_products",\n]\n', "shopify.app.toml", "__A__", "read_products"),
    ],
    [
      "toml two placeholders in one string",
      inject(
        inject('scopes = ["__A__ and __B__"]\n', "shopify.app.toml", "__A__", "aaa"),
        "shopify.app.toml",
        "__B__",
        "bbb",
      ),
    ],
    [
      "markup text content with apostrophes",
      inject("<p>it's __A__ fine</p>\n", "extensions/x/b.html", "__A__", "https://example.com"),
    ],
    [
      "multi-marker",
      inject(
        inject('{{ "__A__" }}|{{ "__B__" }}\n', filePath, "__A__", "aaa"),
        filePath,
        "__B__",
        "bbb",
      ),
    ],
    [
      "unicode",
      inject("{{ '__代理__' }}\n", filePath, "__代理__", "https://例.com/😀"),
    ],
    [
      "marker-like text outside value",
      "// /* bshopify-restore:YWJj:1:aaaaaaaaaaaaaaaa:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb */\nconst x = 1;\n",
    ],
    ["plain", "const x = 1;\n"],
    ["empty", ""],
  ];

  it.each(cases)("matches the TS restore for %s", async (_label, content) => {
    const scriptPath = await writeCleanFilterScript();
    const scriptOut = (await runCleanFilter(scriptPath, content)).stdout.toString("utf8");

    expect(scriptOut).toBe(restoreInjectedMarkers(content));
  });
});
