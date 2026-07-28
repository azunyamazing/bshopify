import { execa } from "execa";
import { isNodeError } from "#/utils/node";

export async function runShopifyCommand(args: string[], cwd: string): Promise<number> {
  try {
    const result = await execa("shopify", args, {
      cwd,
      localDir: cwd,
      preferLocal: true,
      stdio: "inherit",
    });

    return result.exitCode ?? 0;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(
        "Shopify CLI is not available. Install it globally with npm install -g @shopify/cli@latest, or add @shopify/cli to this project.",
      );
    }

    throw error;
  }
}
