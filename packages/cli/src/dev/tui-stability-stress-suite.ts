import { fileURLToPath } from "node:url";
import { DEFAULT_NATIVE_STRESS_MATRIX } from "./tui-soak-options";

const soakEntrypoint = fileURLToPath(new URL("./tui-stability-soak.tsx", import.meta.url));
const startedAt = Date.now();

for (const item of DEFAULT_NATIVE_STRESS_MATRIX) {
  console.log(`\n[tui:stress] ${item.workload} ${item.durationSeconds}s`);
  const child = Bun.spawn([
    process.execPath,
    "run",
    soakEntrypoint,
    "--workload",
    item.workload,
    "--duration",
    String(item.durationSeconds),
    "--render-profile",
    "normal",
  ], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    console.error(JSON.stringify({
      result: "fail",
      suite: "native-stress",
      failedWorkload: item.workload,
      exitCode,
      elapsedMs: Date.now() - startedAt,
    }));
    process.exit(exitCode);
  }
}

console.log(JSON.stringify({
  result: "pass",
  suite: "native-stress",
  elapsedMs: Date.now() - startedAt,
  matrix: DEFAULT_NATIVE_STRESS_MATRIX,
}));
