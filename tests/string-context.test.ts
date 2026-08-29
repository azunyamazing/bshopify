import { describe, expect, it } from "vitest";
import {
  findInjectionContext,
  getInjectionSyntax,
  type InjectionContext,
} from "../src/utils/string-context";

function contextOf(content: string, pattern: string, path: string): InjectionContext | undefined {
  const matchStart = content.indexOf(pattern);
  expect(matchStart).toBeGreaterThanOrEqual(0);
  return findInjectionContext(content, matchStart, getInjectionSyntax(path));
}

describe("getInjectionSyntax", () => {
  it("treats html/liquid files as markup and everything else as code", () => {
    expect(getInjectionSyntax("a/b.liquid")).toBe("markup");
    expect(getInjectionSyntax("a/b.html")).toBe("markup");
    expect(getInjectionSyntax("a/b.HTM")).toBe("markup");
    expect(getInjectionSyntax("a/b.js")).toBe("code");
    expect(getInjectionSyntax("a/b.tsx")).toBe("code");
    expect(getInjectionSyntax("a/b.css")).toBe("code");
  });
});

describe("findInjectionContext (code)", () => {
  it("detects a placeholder inside a double-quoted string", () => {
    const content = 'value: "REPLACE_WITH_CATALOG_API_URL",\n';
    const context = contextOf(content, "REPLACE_WITH_CATALOG_API_URL", "app.js");

    expect(context).toBeDefined();
    expect(context!.insertAt).toBe(context!.end);
    expect(content.slice(context!.start, context!.end)).toBe('"REPLACE_WITH_CATALOG_API_URL"');
  });

  it("detects a placeholder inside a single-quoted string", () => {
    expect(contextOf("const a = 'x__URL__y';\n", "__URL__", "app.js")).toBeDefined();
  });

  it("detects a placeholder inside a template literal", () => {
    expect(contextOf("const url = `https://x.com/__URL__/y`;\n", "__URL__", "app.js")).toBeDefined();
  });

  it("detects a placeholder inside an interpolation string of a template literal", () => {
    expect(
      contextOf('const url = `https://x.com/${"__URL__"}`;\n', "__URL__", "app.js"),
    ).toBeDefined();
  });

  it("does not treat quotes inside comments as strings", () => {
    expect(contextOf('// "not a string"\nconst url = __URL__;\n', "__URL__", "app.js")).toBeUndefined();
    expect(contextOf('/* "not a string" */\nconst url = __URL__;\n', "__URL__", "app.js")).toBeUndefined();
  });

  it("ignores apostrophes in JSX text content (unterminated runs)", () => {
    expect(contextOf("const el = <p>it's __URL__ fine</p>;\n", "__URL__", "App.tsx")).toBeUndefined();
  });

  it("detects strings in jsx attributes but not plain expressions", () => {
    expect(contextOf('const el = <a href="__URL__">x</a>;\n', "__URL__", "App.tsx")).toBeDefined();
    expect(contextOf("const el = <a href={__URL__}>x</a>;\n", "__URL__", "App.tsx")).toBeUndefined();
  });
});

describe("findInjectionContext (markup)", () => {
  it("detects a placeholder inside an HTML attribute value", () => {
    const content = '<a href="__URL__">go</a>\n';
    const context = contextOf(content, "__URL__", "b.html");

    expect(context).toBeDefined();
    expect(content.slice(context!.start, context!.end)).toBe('"__URL__"');
  });

  it("leaves quotes in HTML text content alone", () => {
    expect(contextOf("<p>it's __URL__ fine</p>\n", "__URL__", "b.html")).toBeUndefined();
  });

  it("detects a placeholder inside a Liquid output unit", () => {
    const content = '{{ "__URL__" }}\n';
    const context = contextOf(content, "__URL__", "b.liquid");

    expect(context).toBeDefined();
    expect(context!.insertAt).toBe(context!.end);
    expect(content.slice(context!.start, context!.end)).toBe('{{ "__URL__" }}');
  });

  it("detects an unquoted placeholder inside a Liquid output unit", () => {
    expect(contextOf("{{ __URL__ }}\n", "__URL__", "b.liquid")).toBeDefined();
  });

  it("detects a placeholder inside a Liquid assign tag", () => {
    expect(contextOf('{% assign base = "__URL__" %}\n', "__URL__", "b.liquid")).toBeDefined();
  });

  it("detects a placeholder inside a Liquid unit in an attribute", () => {
    expect(contextOf('<a href="{{ __URL__ }}">go</a>\n', "__URL__", "b.liquid")).toBeDefined();
  });

  it("skips Liquid comments when scanning", () => {
    expect(
      contextOf('{% comment %} "not a string" {% endcomment %}\n{{ __URL__ }}\n', "__URL__", "b.liquid"),
    ).toBeDefined();
  });

  it("detects strings inside a liquid schema JSON body", () => {
    const content = '{% schema %}\n{ "settings": [{ "default": "__URL__" }] }\n{% endschema %}\n';
    const matchStart = content.indexOf("__URL__");
    const context = findInjectionContext(content, matchStart, "markup");

    expect(context).toBeDefined();
    expect(content.slice(context!.start, context!.end)).toBe('"__URL__"');
  });
});
