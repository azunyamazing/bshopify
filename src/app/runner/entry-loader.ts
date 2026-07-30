import { register } from "node:module";
import { pathToFileURL } from "node:url";

interface ExtensionEntryModule {
  default: unknown;
}

const bshopifyEntryLoaderParam = "bshopify-entry-loader";
let bshopifyEntryLoaderRegistered = false;

export async function loadExtensionEntryModule(
  entryPath: string,
): Promise<ExtensionEntryModule> {
  ensureBshopifyEntryLoader();

  return import(formatEntryImportUrl(entryPath)) as Promise<ExtensionEntryModule>;
}

function ensureBshopifyEntryLoader(): void {
  if (bshopifyEntryLoaderRegistered) {
    return;
  }

  register(`data:text/javascript,${encodeURIComponent(formatLoaderSource())}`);
  bshopifyEntryLoaderRegistered = true;
}

function formatEntryImportUrl(entryPath: string): string {
  const url = pathToFileURL(entryPath);
  url.searchParams.set(bshopifyEntryLoaderParam, `${Date.now()}`);

  return url.href;
}

function formatLoaderSource(): string {
  return `
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const loaderParam = ${JSON.stringify(bshopifyEntryLoaderParam)};

function isBshopifyEntryUrl(url) {
  try {
    return new URL(url).searchParams.has(loaderParam);
  } catch {
    return false;
  }
}

function canLoadAsModule(url) {
  const parsed = new URL(url);

  return parsed.protocol === "file:"
    && /\\.(?:js|mjs)$/.test(parsed.pathname);
}

export async function load(url, context, nextLoad) {
  if (!isBshopifyEntryUrl(url) || !canLoadAsModule(url)) {
    return nextLoad(url, context);
  }

  return {
    format: "module",
    shortCircuit: true,
    source: await readFile(fileURLToPath(url), "utf8"),
  };
}
`;
}
