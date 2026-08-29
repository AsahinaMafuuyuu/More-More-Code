import { describe, expect, test } from "bun:test";
import { fetchProvider, NativeProviderHttpError, parseSSE } from "../src/lib/provider-http";

describe("native provider HTTP/SSE", () => {
    test("parses CRLF, multiline data, comments, and final unterminated events", async () => {
        const body = new Response(
            ": heartbeat\r\nevent: alpha\r\ndata: {\"a\":\r\ndata: 1}\r\n\r\ndata: tail",
        ).body;
        const events = [];
        for await (const event of parseSSE(body)) events.push(event);
        expect(events).toEqual([
            { event: "alpha", data: "{\"a\":\n1}" },
            { data: "tail" },
        ]);
    });

    test("keeps non-2xx provider bodies out of surfaced errors", async () => {
        const fetch = async () => new Response("secret provider diagnostic payload", { status: 400 });
        await expect(fetchProvider({
            url: "https://provider.invalid/v1/messages",
            init: { method: "POST" },
            fetch: fetch as unknown as typeof globalThis.fetch,
            timeoutMs: 1_000,
        })).rejects.toMatchObject({
            name: "NativeProviderHttpError",
            status: 400,
        });
        try {
            await fetchProvider({
                url: "https://provider.invalid/v1/messages",
                init: { method: "POST" },
                fetch: fetch as unknown as typeof globalThis.fetch,
            });
        } catch (error) {
            expect(error).toBeInstanceOf(NativeProviderHttpError);
            expect(String(error)).not.toContain("secret provider diagnostic payload");
        }
    });

    test("retries retryable status and honors x-should-retry=false", async () => {
        let calls = 0;
        const fetch = async () => {
            calls += 1;
            return calls === 1
                ? new Response("busy", { status: 503, headers: { "retry-after-ms": "0" } })
                : new Response("ok", { status: 200 });
        };
        await expect(fetchProvider({
            url: "https://provider.invalid",
            init: { method: "POST" },
            fetch: fetch as unknown as typeof globalThis.fetch,
            maxRetries: 1,
        })).resolves.toMatchObject({ status: 200 });
        expect(calls).toBe(2);

        calls = 0;
        const noRetry = async () => {
            calls += 1;
            return new Response("busy", { status: 503, headers: { "x-should-retry": "false" } });
        };
        await expect(fetchProvider({
            url: "https://provider.invalid",
            init: { method: "POST" },
            fetch: noRetry as unknown as typeof globalThis.fetch,
            maxRetries: 3,
        })).rejects.toBeInstanceOf(NativeProviderHttpError);
        expect(calls).toBe(1);
    });

    test("times out a stalled SSE body after headers were received", async () => {
        const body = new ReadableStream<Uint8Array>({
            start() {
                // Intentionally never enqueue or close.
            },
        });
        const consume = async () => {
            for await (const _event of parseSSE(body, undefined, 10)) {
                // no-op
            }
        };
        await expect(consume()).rejects.toMatchObject({ name: "AbortError" });
    });
});
