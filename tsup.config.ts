import { createRequire } from "node:module";
import { defineConfig } from "tsup";

interface PackageJson {
  name: string;
  version: string;
}

const require = createRequire(import.meta.url);
const packageJson = require("./package.json") as PackageJson;

export default defineConfig({
  clean: true,
  define: {
    __BSHOPIFY_PACKAGE_NAME__: JSON.stringify(packageJson.name),
    __BSHOPIFY_PACKAGE_VERSION__: JSON.stringify(packageJson.version),
  },
  dts: true,
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  target: "node22",
});
