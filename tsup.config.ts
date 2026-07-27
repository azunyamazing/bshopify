import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  target: "node22",
});
