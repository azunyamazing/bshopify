import { constants } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isNodeError } from "#/utils/node";

export interface LockHandle {
  recoveredStaleLock: boolean;
  release(): Promise<void>;
}

export async function acquireLock(
  cwd: string,
  tmpRootName: string,
): Promise<LockHandle> {
  const tmpRoot = join(cwd, tmpRootName);
  const lockPath = join(tmpRoot, "extension-prepare.lock");
  await mkdir(tmpRoot, { recursive: true });

  let handle;
  let recoveredStaleLock = false;

  try {
    handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      if (await cleanupStaleLock(lockPath)) {
        recoveredStaleLock = true;
        handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      } else {
        throw new Error("Shopify extension prepare is already running.");
      }
    } else {
      throw error;
    }
  }

  try {
    await handle.writeFile(`${process.pid}\n`);
  } finally {
    await handle.close();
  }

  return {
    recoveredStaleLock,
    async release() {
      await rm(lockPath, { force: true });
    },
  };
}

async function cleanupStaleLock(lockPath: string): Promise<boolean> {
  const pid = await readLockPid(lockPath);

  if (pid !== undefined && isProcessRunning(pid)) {
    return false;
  }

  await rm(lockPath, { force: true });
  return true;
}

async function readLockPid(lockPath: string): Promise<number | undefined> {
  const content = await readFile(lockPath, "utf8");
  const pid = Number(content.trim());

  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }

  return pid;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") {
      return false;
    }

    return true;
  }
}
