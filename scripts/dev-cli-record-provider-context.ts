/**
 * TEMP_PROVIDER_CONTEXT_RECORDER
 *
 * Diagnostic launcher for cache investigation. It enables exact Provider request
 * body capture before starting the normal CLI. Remove this launcher together
 * with packages/cli/src/lib/provider-request-recorder.ts after the investigation.
 */
process.env.MORE_MORE_CODE_RECORD_PROVIDER_CONTEXT = "1";

await import("../packages/cli/src/index.tsx");
