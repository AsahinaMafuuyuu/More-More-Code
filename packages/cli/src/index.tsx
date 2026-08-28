import { assertSupportedBunRuntime } from "./tui/runtime-compatibility";

// This bootstrap must remain free of OpenTUI/React imports. Static ESM imports
// are evaluated before module code, so the Bun guard has to run before the
// application module (and therefore opentui.dll) is loaded.
assertSupportedBunRuntime(Bun.version, Bun.revision);

await import("./app-entry");
