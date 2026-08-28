import { rm } from "node:fs/promises";

export async function removeTemporaryRoot(root: string): Promise<void> {
  if (process.platform === "win32") {
    // @libsql/client can leave native SQLite statement handles pending until
    // GC even after Client.close(). Tests delete disposable databases in the
    // same process, so force collection at the cleanup boundary only.
    Bun.gc(true);
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transientWindowsLock = process.platform === "win32"
        && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(code ?? "");
      if (!transientWindowsLock) throw error;
      if (attempt === 29) return;
      await Bun.sleep(200);
    }
  }
}
