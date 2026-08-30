import { assertSupportedBunRuntime } from "../tui/runtime-compatibility";

// Keep the native soak bootstrap aligned with the production CLI boundary:
// validate Bun before importing OpenTUI or loading opentui.dll.
assertSupportedBunRuntime(Bun.version, Bun.revision);

await import("./tui-stability-soak-app");
