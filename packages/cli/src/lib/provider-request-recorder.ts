import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ResolvedModel } from "./models";
import type { NativeModelRequest } from "./provider-native-protocol";
import { sha256, stableSerialize } from "./cache-identity";

const ENABLE_ENV = "MORE_MORE_CODE_RECORD_PROVIDER_CONTEXT";
const OUTPUT_DIR_ENV = "MORE_MORE_CODE_PROVIDER_CONTEXT_LOG_DIR";

let recorderSessionDirectory: string | null = null;
let recorderSequence = 0;
let recorderWriteTail: Promise<void> = Promise.resolve();

function enabled() {
    const value = process.env[ENABLE_ENV]?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes" || value === "on";
}

function safeSegment(value: string) {
    return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 96) || "unknown";
}

function sessionDirectoryName() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${timestamp}-pid-${process.pid}`;
}

async function resolveRecorderSessionDirectory() {
    if (recorderSessionDirectory) return recorderSessionDirectory;
    const baseDirectory = process.env[OUTPUT_DIR_ENV]?.trim()
        || join(homedir(), ".more-more-code", "diagnostics", "provider-context");
    recorderSessionDirectory = join(baseDirectory, sessionDirectoryName());
    await mkdir(recorderSessionDirectory, { recursive: true });
    return recorderSessionDirectory;
}

function digest(value: unknown) {
    return sha256(stableSerialize(value));
}

/**
 * TEMP_PROVIDER_CONTEXT_RECORDER
 *
 * Temporary, opt-in cache-diagnostics recorder. When enabled it writes the exact
 * provider JSON request body before the network side effect. The recorder never
 * stores authorization headers or credential material added by authHeaders().
 *
 * Diagnostic mode is intentionally fail-closed: if a capture cannot be written,
 * the Provider request is not sent. This guarantees that every Provider request
 * made while the recorder is enabled has a corresponding local capture.
 *
 * Remove this module and all call sites after cache-prefix investigation closes.
 */
export async function recordProviderRequestContext(input: {
    model: ResolvedModel;
    request: NativeModelRequest;
    wireBodyText: string;
}) {
    if (!enabled()) return null;

    const sequence = ++recorderSequence;
    const operation = async () => {
        const directory = await resolveRecorderSessionDirectory();
        const sequenceLabel = String(sequence).padStart(6, "0");
        const modelLabel = safeSegment(input.model.modelId);
        const protocolLabel = safeSegment(input.model.protocol);
        const basename = `${sequenceLabel}-${protocolLabel}-${modelLabel}`;
        const requestFileName = `${basename}.request.json`;
        const metadataFileName = `${basename}.meta.json`;
        const requestPath = join(directory, requestFileName);
        const metadataPath = join(directory, metadataFileName);
        const capturedAt = new Date().toISOString();
        const wireBodySha256 = sha256(input.wireBodyText);
        const metadata = {
            schemaVersion: 1,
            temporaryDiagnostic: true,
            sequence,
            capturedAt,
            processId: process.pid,
            providerId: input.model.providerId,
            providerKind: input.model.provider,
            protocol: input.model.protocol,
            modelId: input.model.modelId,
            requestClass: input.request.prefixIdentity
                ? "cache-identified-primary-request"
                : "auxiliary-provider-request",
            cacheRetention: input.request.cacheRetention ?? "short",
            prefixIdentity: input.request.prefixIdentity ?? null,
            nativeContext: {
                messageCount: input.request.messages.length,
                toolDefinitionCount: input.request.tools.length,
                systemSha256: sha256(input.request.system),
                messagesSha256: digest(input.request.messages),
                toolsSha256: digest(input.request.tools),
            },
            wire: {
                requestFileName,
                bytes: Buffer.byteLength(input.wireBodyText),
                sha256: wireBodySha256,
            },
        };

        // Keep the exact bytes that will be handed to fetchProvider(). Do not
        // pretty-print or parse/re-serialize them, otherwise cache debugging can
        // miss ordering/serialization differences.
        await writeFile(requestPath, input.wireBodyText, "utf8");
        await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
        await appendFile(join(directory, "manifest.jsonl"), `${JSON.stringify(metadata)}\n`, "utf8");

        return {
            directory,
            requestPath,
            metadataPath,
            sequence,
            wireBodySha256,
        };
    };

    const current = recorderWriteTail.then(operation);
    recorderWriteTail = current.then(() => undefined, () => undefined);
    return current;
}

/** Test-only seam for deterministic temporary-recorder coverage. */
export async function resetProviderRequestRecorderForTests() {
    await recorderWriteTail;
    recorderSessionDirectory = null;
    recorderSequence = 0;
    recorderWriteTail = Promise.resolve();
}
