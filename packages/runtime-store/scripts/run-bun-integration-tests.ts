import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "more-more-code-runtime-store-tests-"));

try {
  const child = Bun.spawn({
    cmd: ["bun", "test", "tests"],
    cwd: packageRoot,
    env: {
      ...process.env,
      RUNTIME_STORE_TEST_ROOT: temporaryRoot,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
} finally {
  // libSQL closes all local file handles when the child Bun process exits.
  // The parent process can then reliably remove every database and sidecar.
  await rm(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
