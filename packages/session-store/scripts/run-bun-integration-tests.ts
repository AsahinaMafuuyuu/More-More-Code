import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "more-more-code-session-store-tests-"));

try {
  const child = Bun.spawn({
    cmd: ["bun", "test", "tests"],
    cwd: packageRoot,
    env: {
      ...process.env,
      SESSION_STORE_TEST_ROOT: temporaryRoot,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
} finally {
  // libsql closes local file handles only when the child Bun process exits.
  await rm(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
