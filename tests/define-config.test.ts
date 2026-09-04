import { describe, expect, it } from "vitest";
import { defineConfig, type RunnerConfigInput } from "../src";

describe("defineConfig", () => {
  it("returns the passed config unchanged (identity for typing)", () => {
    const config: RunnerConfigInput = {
      configFiles: { dev: "shopify.app.dev.toml" },
      envFiles: { aEnv: ["config/a.json", "config/a.toml"] },
      failOnUnresolvedPlaceholders: true,
    };

    expect(defineConfig(config)).toBe(config);
  });

  it("accepts partial configs whose omitted fields fall back to defaults", () => {
    const config = defineConfig({ restoreMarkers: false });

    expect(config.restoreMarkers).toBe(false);
    expect(config.configFiles).toBeUndefined();
    expect(config.entryFileName).toBeUndefined();
  });
});
