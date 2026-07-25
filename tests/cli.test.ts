import { describe, expect, it } from "vitest";
import { createCliProgram, packageInfo } from "../src/index.js";

describe("bshopify CLI", () => {
  it("exposes the package name and version", () => {
    expect(packageInfo.name).toBe("@bestfulfill/bshopify");
    expect(packageInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("registers the MVP command surface from the technical plan", () => {
    const program = createCliProgram();
    const commands = program.commands.map((command) => command.name()).sort();

    expect(commands).toEqual([
      "deploy",
      "dev",
      "guard",
      "init",
      "restore",
      "validate",
    ]);
  });
});

