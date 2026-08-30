const MAX_ERROR_BODY_BYTES = 4_096;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

export class NativeProviderHttpError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly headers?: Headers,
    ) {
        super(message);
        this.name = "NativeProviderHttpError";
    }
}

function createAbortError(message = "Provider request aborted") {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
}

function mergeAbortSignals(signal: AbortSignal | undefined, timeoutMs: number | undefined) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort(signal?.reason ?? createAbortError());
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    if (timeoutMs != null && timeoutMs > 0) {
        timeout = setTimeout(
            () => controller.abort(createAbortError(`Provider request timed out after ${timeoutMs}ms`)),
            timeoutMs,
        );
    }
    return {
        signal: controller.signal,
        dispose() {
            if (timeout) clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
        },
    };
}

async function readBoundedBody(response: Response, signal: AbortSignal) {
    const reader = response.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    try {
        while (bytes < MAX_ERROR_BODY_BYTES) {
            if (signal.aborted) throw createAbortError();
            const next = await reader.read();
            if (next.done) break;
            const remaining = MAX_ERROR_BODY_BYTES - bytes;
            const chunk = next.value.byteLength > remaining ? next.value.slice(0, remaining) : next.value;
            chunks.push(decoder.decode(chunk, { stream: true }));
            bytes += chunk.byteLength;
            if (chunk.byteLength < next.value.byteLength) break;
        }
        chunks.push(decoder.decode());
        return chunks.join("");
    } finally {
        void reader.cancel();
    }
}

function retryable(error: unknown) {
    if (!(error instanceof NativeProviderHttpError)) return true;
    const override = error.headers?.get("x-should-retry");
    if (override === "true") return true;
    if (override === "false") return false;
    return error.status == null
        || error.status === 408
        || error.status === 409
        || error.status === 429
        || error.status >= 500;
}

function retryDelay(error: NativeProviderHttpError | undefined, retryIndex: number, maxRetryDelayMs?: number) {
    const retryAfterMs = error?.headers?.get("retry-after-ms");
    const retryAfter = error?.headers?.get("retry-after");
    let delay: number | undefined;
    if (retryAfterMs) {
        const parsed = Number.parseFloat(retryAfterMs);
        if (Number.isFinite(parsed)) delay = parsed;
    } else if (retryAfter) {
        const seconds = Number.parseFloat(retryAfter);
        delay = Number.isFinite(seconds) ? seconds * 1_000 : Math.max(0, Date.parse(retryAfter) - Date.now());
    }
    if (delay == null) delay = Math.min(500 * 2 ** retryIndex, 8_000) * (1 - Math.random() * 0.25);
    const maxDelay = maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    if (maxDelay > 0 && delay > maxDelay) {
        throw new Error(`Provider requested ${Math.ceil(delay / 1_000)}s retry delay (max ${Math.ceil(maxDelay / 1_000)}s)`);
    }
    return delay;
}

async function abortableSleep(ms: number, signal?: AbortSignal) {
    await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(createAbortError());
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, Math.max(0, ms));
        const onAbort = () => {
            clearTimeout(timer);
            reject(createAbortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
export async function fetchProvider(input: {
    url: string;
    init: RequestInit;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
    maxRetryDelayMs?: number;
    fetch?: typeof globalThis.fetch;
}): Promise<Response> {
    const maxRetries = input.maxRetries ?? 0;
    for (let attempt = 0; ; attempt += 1) {
        const merged = mergeAbortSignals(input.signal, input.timeoutMs ?? 120_000);
        try {
            const response = await (input.fetch ?? globalThis.fetch)(input.url, {
                ...input.init,
                signal: merged.signal,
            });
            if (response.ok) return response;
            const marker = await readBoundedBody(response, merged.signal);
            const error = new NativeProviderHttpError(
                `Provider request failed (HTTP ${response.status})${marker ? ": response body withheld" : ""}`,
                response.status,
                response.headers,
            );
            if (attempt >= maxRetries || !retryable(error)) throw error;
            await abortableSleep(retryDelay(error, attempt, input.maxRetryDelayMs), input.signal);
        } catch (error) {
            if (input.signal?.aborted || merged.signal.aborted) throw createAbortError();
            if (attempt >= maxRetries || !retryable(error)) {
                if (error instanceof Error) throw error;
                throw new NativeProviderHttpError("Provider request failed before receiving a response");
            }
            await abortableSleep(
                retryDelay(error instanceof NativeProviderHttpError ? error : undefined, attempt, input.maxRetryDelayMs),
                input.signal,
            );
        } finally {
            merged.dispose();
        }
    }
}

export type SSEEvent = { event?: string; data: string };

export async function* parseSSE(
    body: ReadableStream<Uint8Array> | null,
    signal?: AbortSignal,
    idleTimeoutMs?: number,
): AsyncGenerator<SSEEvent> {
    if (!body) throw new NativeProviderHttpError("Provider returned an empty streaming body");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName: string | undefined;
    let dataLines: string[] = [];

    const flush = () => {
        if (dataLines.length === 0) {
            eventName = undefined;
            return null;
        }
        const event = { ...(eventName ? { event: eventName } : {}), data: dataLines.join("\n") };
        eventName = undefined;
        dataLines = [];
        return event;
    };

    try {
        while (true) {
            if (signal?.aborted) throw createAbortError();
            const next = await readStreamChunk(reader, signal, idleTimeoutMs);
            if (next.done) break;
            buffer += decoder.decode(next.value, { stream: true });
            while (true) {
                const newline = buffer.indexOf("\n");
                if (newline < 0) break;
                let line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                if (line.endsWith("\r")) line = line.slice(0, -1);
                if (line === "") {
                    const event = flush();
                    if (event) yield event;
                    continue;
                }
                if (line.startsWith(":")) continue;
                const colon = line.indexOf(":");
                const field = colon < 0 ? line : line.slice(0, colon);
                let value = colon < 0 ? "" : line.slice(colon + 1);
                if (value.startsWith(" ")) value = value.slice(1);
                if (field === "event") eventName = value;
                else if (field === "data") dataLines.push(value);
            }
        }
        buffer += decoder.decode();
        if (buffer) {
            const lines = buffer.split(/\r?\n/);
            for (const line of lines) {
                if (!line || line.startsWith(":")) continue;
                const colon = line.indexOf(":");
                const field = colon < 0 ? line : line.slice(0, colon);
                let value = colon < 0 ? "" : line.slice(colon + 1);
                if (value.startsWith(" ")) value = value.slice(1);
                if (field === "event") eventName = value;
                else if (field === "data") dataLines.push(value);
            }
        }
        const event = flush();
        if (event) yield event;
    } finally {
        void reader.cancel();
    }
}

async function readStreamChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal?: AbortSignal,
    idleTimeoutMs?: number,
) {
    if (!idleTimeoutMs || idleTimeoutMs <= 0) return reader.read();
    type ReaderResult = Awaited<ReturnType<typeof reader.read>>;
    return new Promise<ReaderResult>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
            callback();
        };
        const onAbort = () => finish(() => reject(createAbortError()));
        const timeout = setTimeout(() => {
            void reader.cancel();
            finish(() => reject(createAbortError(`Provider stream was idle for ${idleTimeoutMs}ms`)));
        }, idleTimeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        void reader.read().then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error)),
        );
    });
}
