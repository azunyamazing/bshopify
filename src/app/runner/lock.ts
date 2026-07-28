import { constants } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { isNodeError } from "#/utils/node";

export async function acquireLock(
  cwd: string,
  tmpRootName: string,
): Promise<{ release(): Promise<void> }> {
  const tmpRoot = join(cwd, tmpRootName);
  const lockPath = join(tmpRoot, "extension-prepare.lock");
  await mkdir(tmpRoot, { recursive: true });

  let handle;

  try {
    handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error("Shopify extension prepare is already running.");
    }

    throw error;
  }

  try {
    await handle.writeFile(`${process.pid}\n`);
  } finally {
    await handle.close();
  }

  return {
    async release() {
      await rm(lockPath, { force: true });
    },
  };
}
