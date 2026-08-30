import type { ResolvedModel } from "./models";
import { fetchProvider, parseSSE } from "./provider-http";
import type {
    NativeModelMessage,
    NativeModelRequest,
    NativeToolDefinition,
    ProviderExecutionOptions,
    ProviderFinishReason,
    ProviderStreamEvent,
} from "./provider-native-protocol";
import type { ProviderUsage } from "./provider-usage";
import { recordProviderRequestContext } from "./provider-request-recorder";
import { createRenderedPrefixDigest } from "./cache-identity";

type StablePrefix = {
    system: string;
    tools: NativeToolDefinition[];
};

const STABLE_PREFIX_CACHE_CAPACITY = 32;
const stablePrefixCache = new Map<string, StablePrefix>();
let prefixHits = 0;
let prefixMisses = 0;

export type ProviderCacheCapabilities = {
    promptCacheKey: boolean;
    explicitBreakpoints: boolean;
    promptCacheOptions: boolean;
    allowedToolsMask: boolean;
};

export function resolveProviderCacheCapabilities(model: ResolvedModel): ProviderCacheCapabilities {
    const nativeOpenAIResponses = model.provider === "openai" && model.protocol === "openai-responses";
    const gpt56OrLater = nativeOpenAIResponses && /^gpt-(?:5\.(?:[6-9]|\d{2,})|[6-9](?:\.|-|$))/i.test(model.modelId);
    return {
        promptCacheKey: nativeOpenAIResponses,
        explicitBreakpoints: gpt56OrLater,
        promptCacheOptions: gpt56OrLater,
        allowedToolsMask: gpt56OrLater,
    };
}

function stablePrefixKey(model: ResolvedModel, request: NativeModelRequest) {
    return [
        model.providerId,
        model.modelId,
        model.protocol,
        request.prefixIdentity?.fingerprint ?? `uncached:${request.system}`,
        request.prefixIdentity?.toolSetFingerprint ?? "uncached",
        request.cacheRetention ?? "short",
    ].join(":");
}

function getStablePrefix(model: ResolvedModel, request: NativeModelRequest): StablePrefix {
    if (!request.prefixIdentity) {
        return {
            system: request.system,
            tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: structuredClone(tool.inputSchema),
            })),
        };
    }
    const key = stablePrefixKey(model, request);
    const existing = stablePrefixCache.get(key);
    if (existing) {
        prefixHits += 1;
        stablePrefixCache.delete(key);
        stablePrefixCache.set(key, existing);
        return existing;
    }
    prefixMisses += 1;
    const prefix = Object.freeze({
        system: request.system,
        tools: request.tools.map((tool) => Object.freeze({
            name: tool.name,
            description: tool.description,
            inputSchema: structuredClone(tool.inputSchema),
        })) as NativeToolDefinition[],
    }) as StablePrefix;
    stablePrefixCache.set(key, prefix);
    while (stablePrefixCache.size > STABLE_PREFIX_CACHE_CAPACITY) {
        const oldest = stablePrefixCache.keys().next().value;
        if (oldest == null) break;
        stablePrefixCache.delete(oldest);
    }
    return prefix;
}

export function getProviderPrefixCacheStats() {
    return { size: stablePrefixCache.size, hits: prefixHits, misses: prefixMisses, capacity: STABLE_PREFIX_CACHE_CAPACITY };
}

export function resetProviderPrefixCache() {
    stablePrefixCache.clear();
    prefixHits = 0;
    prefixMisses = 0;
}

function authHeaders(model: ResolvedModel) {
    const headers = new Headers({
        accept: "text/event-stream, application/json",
        "content-type": "application/json",
    });
    if (model.protocol === "anthropic-messages") {
        if (model.auth.type !== "api-key") throw new Error("Anthropic requires API-key authentication");
        headers.set("x-api-key", model.auth.value);
        headers.set("anthropic-version", "2023-06-01");
        return headers;
    }
    if (model.protocol === "google-generative-ai") {
        if (model.auth.type !== "api-key") throw new Error("Google Generative AI requires API-key authentication");
        headers.set("x-goog-api-key", model.auth.value);
        return headers;
    }
    if (model.auth.type !== "none") headers.set("authorization", `Bearer ${model.auth.value}`);
    return headers;
}

function json(value: unknown) {
    return JSON.stringify(value ?? null);
}

function mapFinishReason(value: unknown): ProviderFinishReason {
    switch (String(value ?? "").toLowerCase()) {
        case "stop":
        case "end_turn":
        case "stop_sequence":
            return "stop";
        case "tool_calls":
        case "tool_use":
            return "tool-calls";
        case "length":
        case "max_tokens":
        case "max_output_tokens":
            return "length";
        case "content_filter":
        case "safety":
            return "content-filter";
        default:
            return "unknown";
    }
}

function calculateNoCache(total: number | undefined, cacheRead: number | undefined, cacheWrite = 0) {
    if (total == null || cacheRead == null) return undefined;
    return Math.max(0, total - cacheRead - cacheWrite);
}

function openAIUsage(raw: any): ProviderUsage | undefined {
    if (!raw) return undefined;
    const inputTokens = numberOrUndefined(raw.input_tokens ?? raw.prompt_tokens);
    const cacheReadTokens = numberOrUndefined(
        raw.input_tokens_details?.cached_tokens
        ?? raw.prompt_tokens_details?.cached_tokens
        ?? raw.prompt_cache_hit_tokens,
    );
    const cacheWriteTokens = numberOrUndefined(raw.cache_creation_input_tokens);
    const explicitMiss = numberOrUndefined(raw.prompt_cache_miss_tokens);
    const outputTokens = numberOrUndefined(raw.output_tokens ?? raw.completion_tokens);
    const reasoning = numberOrUndefined(
        raw.output_tokens_details?.reasoning_tokens
        ?? raw.completion_tokens_details?.reasoning_tokens,
    );
    return compactUsage({
        inputTokens,
        inputNoCacheTokens: explicitMiss ?? calculateNoCache(inputTokens, cacheReadTokens, cacheWriteTokens ?? 0),
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens,
        outputTextTokens: outputTokens != null && reasoning != null ? Math.max(0, outputTokens - reasoning) : undefined,
        outputReasoningTokens: reasoning,
    });
}

function deepSeekUsage(raw: any): ProviderUsage | undefined {
    if (!raw) return undefined;
    const inputTokens = numberOrUndefined(raw.prompt_tokens);
    const cacheReadTokens = numberOrUndefined(raw.prompt_cache_hit_tokens);
    const cacheMissTokens = numberOrUndefined(raw.prompt_cache_miss_tokens);
    const outputTokens = numberOrUndefined(raw.completion_tokens);
    const reasoning = numberOrUndefined(raw.completion_tokens_details?.reasoning_tokens);

    if (
        inputTokens != null
        && cacheReadTokens != null
        && cacheMissTokens != null
        && cacheReadTokens + cacheMissTokens !== inputTokens
    ) {
        throw new Error(
            "DeepSeek returned inconsistent prompt token/cache-hit/cache-miss usage",
        );
    }

    return compactUsage({
        inputTokens,
        inputNoCacheTokens: cacheMissTokens ?? calculateNoCache(inputTokens, cacheReadTokens),
        cacheReadTokens,
        outputTokens,
        outputTextTokens: outputTokens != null && reasoning != null
            ? Math.max(0, outputTokens - reasoning)
            : undefined,
        outputReasoningTokens: reasoning,
    });
}

function anthropicUsage(raw: any): ProviderUsage | undefined {
    if (!raw) return undefined;
    const input = numberOrUndefined(raw.input_tokens);
    const read = numberOrUndefined(raw.cache_read_input_tokens);
    const write = numberOrUndefined(raw.cache_creation_input_tokens);
    const output = numberOrUndefined(raw.output_tokens);
    const reasoning = numberOrUndefined(raw.output_tokens_details?.thinking_tokens);
    // Anthropic reports input_tokens separately from cache read/create buckets.
    const totalInput = input == null && read == null && write == null
        ? undefined
        : (input ?? 0) + (read ?? 0) + (write ?? 0);
    return compactUsage({
        inputTokens: totalInput,
        inputNoCacheTokens: input,
        cacheReadTokens: read,
        cacheWriteTokens: write,
        outputTokens: output,
        outputTextTokens: output != null && reasoning != null ? Math.max(0, output - reasoning) : output,
        outputReasoningTokens: reasoning,
    });
}

function googleUsage(raw: any): ProviderUsage | undefined {
    if (!raw) return undefined;
    const input = numberOrUndefined(raw.promptTokenCount);
    const read = numberOrUndefined(raw.cachedContentTokenCount);
    const output = numberOrUndefined(raw.candidatesTokenCount);
    const reasoning = numberOrUndefined(raw.thoughtsTokenCount);
    return compactUsage({
        inputTokens: input,
        inputNoCacheTokens: calculateNoCache(input, read),
        cacheReadTokens: read,
        outputTokens: output != null || reasoning != null ? (output ?? 0) + (reasoning ?? 0) : undefined,
        outputTextTokens: output,
        outputReasoningTokens: reasoning,
    });
}

function numberOrUndefined(value: unknown) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function compactUsage(usage: ProviderUsage): ProviderUsage | undefined {
    const compacted: ProviderUsage = {};
    for (const [key, value] of Object.entries(usage) as Array<[keyof ProviderUsage, number | undefined]>) {
        if (value != null) compacted[key] = value;
    }
    return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function providerMetadataRecord(
    metadata: Record<string, unknown> | undefined,
    provider: string,
): Record<string, unknown> | undefined {
    const value = metadata?.[provider];
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function providerMetadataString(
    metadata: Record<string, unknown> | undefined,
    provider: string,
    key: string,
) {
    const value = providerMetadataRecord(metadata, provider)?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function openAIResponseInput(messages: NativeModelMessage[], explicitBreakpoints = false) {
    const input: any[] = [];
    for (const message of messages) {
        const texts = message.content.filter((item) => item.type === "text").map((item) => item.text);
        if (texts.length > 0 && message.role !== "tool") {
            input.push({ role: message.role === "system" ? "developer" : message.role, content: texts.join("\n") });
        }
        for (const item of message.content) {
            if (item.type === "tool-call") {
                input.push({
                    type: "function_call",
                    call_id: item.toolCallId,
                    name: item.toolName,
                    arguments: json(item.input),
                });
            } else if (item.type === "tool-result") {
                input.push({
                    type: "function_call_output",
                    call_id: item.toolCallId,
                    output: typeof item.output === "string" ? item.output : json(item.output),
                });
            }
        }
    }
    if (explicitBreakpoints && input.length > 0) {
        const lastToolOutputIndex = input.findLastIndex((item) => item?.type === "function_call_output");
        if (lastToolOutputIndex >= 0) {
            input[lastToolOutputIndex] = {
                ...input[lastToolOutputIndex],
                prompt_cache_breakpoint: { mode: "explicit" },
            };
        } else {
            const firstMessageIndex = input.findIndex((item) => (
                item && typeof item === "object" && typeof item.role === "string" && typeof item.content === "string"
            ));
            if (firstMessageIndex >= 0) {
                const item = input[firstMessageIndex];
                input[firstMessageIndex] = {
                    ...item,
                    content: [{
                        type: "input_text",
                        text: item.content,
                        prompt_cache_breakpoint: { mode: "explicit" },
                    }],
                };
            }
        }
    }
    return input;
}

function lastNativeToolResult(messages: readonly NativeModelMessage[]) {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const content = messages[messageIndex]?.content ?? [];
        for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
            const item = content[contentIndex];
            if (item?.type === "tool-result") return item;
        }
    }
    return undefined;
}

function openAIExplicitPrefixMaterial(body: Record<string, unknown>) {
    const input = Array.isArray(body.input) ? body.input as any[] : [];
    const breakpointIndex = input.findLastIndex((item) => (
        item && typeof item === "object" && (
            item.prompt_cache_breakpoint?.mode === "explicit"
            || (Array.isArray(item.content) && item.content.some(
                (part: any) => part?.prompt_cache_breakpoint?.mode === "explicit",
            ))
        )
    ));
    return {
        material: {
            instructions: body.instructions,
            tools: body.tools,
            input: breakpointIndex >= 0 ? input.slice(0, breakpointIndex + 1) : [],
        },
        breakpointIndex,
    };
}

async function* streamOpenAIResponses(
    model: ResolvedModel,
    request: NativeModelRequest,
    options: ProviderExecutionOptions,
): AsyncGenerator<ProviderStreamEvent> {
    const stable = getStablePrefix(model, request);
    const cacheRetention = request.cacheRetention ?? "short";
    const capabilities = resolveProviderCacheCapabilities(model);
    const input = openAIResponseInput(request.messages, capabilities.explicitBreakpoints && cacheRetention !== "none");
    const body: Record<string, unknown> = {
        model: model.modelId,
        instructions: stable.system,
        input,
        tools: stable.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: false,
        })),
        stream: true,
        store: false,
        ...(cacheRetention === "none" ? {} : {
            ...(capabilities.promptCacheKey && request.prefixIdentity
                ? { prompt_cache_key: `more-more-code:${request.prefixIdentity.fingerprint}` }
                : {}),
        }),
        ...(capabilities.promptCacheOptions && cacheRetention !== "none"
            ? { prompt_cache_options: { mode: "explicit", ttl: "30m" } }
            : cacheRetention === "long"
                ? { prompt_cache_retention: "24h" }
                : {}),
        ...(capabilities.allowedToolsMask
            && request.allowedToolNames
            && request.allowedToolNames.length > 0
            && request.allowedToolNames.length < stable.tools.length
            ? {
                tool_choice: {
                    type: "allowed_tools",
                    mode: "auto",
                    tools: request.allowedToolNames.map((name) => ({ type: "function", name })),
                },
            }
            : {}),
        ...(request.maxOutputTokens != null ? { max_output_tokens: Math.max(16, request.maxOutputTokens) } : {}),
        ...(request.temperature != null ? { temperature: request.temperature } : {}),
    };
    const lastToolResult = lastNativeToolResult(request.messages);
    const explicitPrefix = openAIExplicitPrefixMaterial(body);
    yield {
        type: "cache-diagnostic",
        renderedPrefix: createRenderedPrefixDigest({
            renderedPrefix: capabilities.explicitBreakpoints
                ? explicitPrefix.material
                : { instructions: body.instructions, tools: body.tools, input: body.input },
            breakpointKind: lastToolResult ? "tool-batch" : capabilities.explicitBreakpoints ? "stable-prefix" : "conversation",
            ...(lastToolResult ? { breakpointId: lastToolResult.toolCallId } : {}),
        }),
    };
    const wireBodyText = JSON.stringify(body);
    await recordProviderRequestContext({ model, request, wireBodyText });
    const response = await fetchProvider({
        url: model.endpoint,
        init: { method: "POST", headers: authHeaders(model), body: wireBodyText },
        ...options,
    });

    const calls = new Map<string, { id: string; name: string; args: string }>();
    let terminal = false;
    for await (const frame of parseSSE(response.body, options.signal, options.timeoutMs ?? 120_000)) {
        if (!frame.data || frame.data === "[DONE]") continue;
        let event: any;
        try { event = JSON.parse(frame.data); } catch { throw new Error("OpenAI Responses returned malformed SSE JSON"); }
        const type = event.type ?? frame.event;
        if (type === "response.output_text.delta" && typeof event.delta === "string") {
            yield { type: "text-delta", text: event.delta };
        } else if (
            (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta")
            && typeof event.delta === "string"
        ) {
            yield { type: "reasoning-delta", text: event.delta };
        } else if (type === "response.output_item.added" && event.item?.type === "function_call") {
            const key = String(event.item.id ?? event.output_index ?? event.item.call_id);
            calls.set(key, {
                id: String(event.item.call_id ?? event.item.id ?? key),
                name: String(event.item.name ?? ""),
                args: String(event.item.arguments ?? ""),
            });
        } else if (type === "response.function_call_arguments.delta") {
            const key = String(event.item_id ?? event.output_index ?? "");
            const call = calls.get(key);
            if (call) call.args += String(event.delta ?? "");
        } else if (type === "response.function_call_arguments.done") {
            const key = String(event.item_id ?? event.output_index ?? "");
            const call = calls.get(key) ?? {
                id: String(event.call_id ?? event.item_id ?? key),
                name: String(event.name ?? ""),
                args: "",
            };
            if (event.arguments != null) call.args = String(event.arguments);
            calls.delete(key);
            yield {
                type: "tool-call",
                toolCallId: call.id,
                toolName: call.name,
                input: parseToolArguments(call.args),
            };
        } else if (type === "response.completed") {
            const usage = openAIUsage(event.response?.usage);
            if (usage) yield { type: "usage", usage };
            terminal = true;
            yield { type: "finish", reason: mapFinishReason(event.response?.status === "completed" ? "stop" : event.response?.incomplete_details?.reason) };
        } else if (type === "response.incomplete") {
            const usage = openAIUsage(event.response?.usage);
            if (usage) yield { type: "usage", usage };
            terminal = true;
            yield { type: "finish", reason: mapFinishReason(event.response?.incomplete_details?.reason ?? "length") };
        } else if (type === "response.failed" || type === "error") {
            throw new Error("OpenAI Responses stream failed");
        }
    }
    if (!terminal) throw new Error("OpenAI Responses stream ended without a terminal event");
}

function anthropicMessages(messages: NativeModelMessage[]) {
    const output: any[] = [];
    for (const message of messages) {
        if (message.role === "system") continue;
        const role = message.role === "assistant" ? "assistant" : "user";
        const content: any[] = [];
        for (const item of message.content) {
            if (item.type === "text") content.push({ type: "text", text: item.text });
            else if (item.type === "reasoning" && message.role === "assistant") {
                const anthropicMetadata = providerMetadataRecord(item.providerMetadata, "anthropic");
                const signature = providerMetadataString(item.providerMetadata, "anthropic", "thinkingSignature");
                if (signature && anthropicMetadata?.redacted === true) {
                    content.push({ type: "redacted_thinking", data: signature });
                } else if (signature) {
                    content.push({ type: "thinking", thinking: item.text, signature });
                }
            }
            else if (item.type === "tool-call") {
                content.push({ type: "tool_use", id: item.toolCallId, name: item.toolName, input: item.input });
            } else if (item.type === "tool-result") {
                content.push({
                    type: "tool_result",
                    tool_use_id: item.toolCallId,
                    content: typeof item.output === "string" ? item.output : json(item.output),
                    ...(item.isError ? { is_error: true } : {}),
                });
            }
        }
        if (content.length === 0) continue;
        const previous = output.at(-1);
        if (previous?.role === role) previous.content.push(...content);
        else output.push({ role, content });
    }
    return output;
}

function applyAnthropicConversationCacheBreakpoint(messages: any[], cacheControl: Record<string, unknown> | undefined) {
    if (!cacheControl || messages.length === 0) return messages;
    const lastMessage = messages.at(-1);
    const lastBlock = lastMessage?.content?.at?.(-1);
    if (lastBlock && typeof lastBlock === "object") {
        lastBlock.cache_control = structuredClone(cacheControl);
    }
    return messages;
}

async function* streamAnthropic(
    model: ResolvedModel,
    request: NativeModelRequest,
    options: ProviderExecutionOptions,
): AsyncGenerator<ProviderStreamEvent> {
    const stable = getStablePrefix(model, request);
    const retention = request.cacheRetention ?? "short";
    const cacheControl = retention === "none"
        ? undefined
        : { type: "ephemeral", ...(retention === "long" ? { ttl: "1h" } : {}) };
    const body = {
        model: model.modelId,
        max_tokens: request.maxOutputTokens ?? 8_192,
        stream: true,
        system: [{ type: "text", text: stable.system, ...(cacheControl ? { cache_control: cacheControl } : {}) }],
        messages: applyAnthropicConversationCacheBreakpoint(
            anthropicMessages(request.messages),
            cacheControl,
        ),
        tools: stable.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
        })),
        ...(request.temperature != null ? { temperature: request.temperature } : {}),
    };
    const anthropicLastToolResult = lastNativeToolResult(request.messages);
    yield {
        type: "cache-diagnostic",
        renderedPrefix: createRenderedPrefixDigest({
            renderedPrefix: { system: body.system, tools: body.tools, messages: body.messages },
            breakpointKind: anthropicLastToolResult ? "tool-batch" : "conversation",
            ...(anthropicLastToolResult ? { breakpointId: anthropicLastToolResult.toolCallId } : {}),
        }),
    };
    const wireBodyText = JSON.stringify(body);
    await recordProviderRequestContext({ model, request, wireBodyText });
    const response = await fetchProvider({
        url: model.endpoint,
        init: { method: "POST", headers: authHeaders(model), body: wireBodyText },
        ...options,
    });
    const toolBlocks = new Map<number, { id: string; name: string; args: string }>();
    const thinkingBlocks = new Map<number, { signature: string; redacted: boolean }>();
    let latestUsage: ProviderUsage = {};
    let stopReason: unknown;
    let terminal = false;
    for await (const frame of parseSSE(response.body, options.signal, options.timeoutMs ?? 120_000)) {
        if (!frame.data) continue;
        let event: any;
        try { event = JSON.parse(frame.data); } catch { throw new Error("Anthropic returned malformed SSE JSON"); }
        const type = event.type ?? frame.event;
        if (type === "message_start") {
            latestUsage = { ...latestUsage, ...(anthropicUsage(event.message?.usage) ?? {}) };
        } else if (type === "content_block_start") {
            if (event.content_block?.type === "tool_use") {
                toolBlocks.set(Number(event.index), {
                    id: String(event.content_block.id),
                    name: String(event.content_block.name),
                    args: event.content_block.input && Object.keys(event.content_block.input).length > 0
                        ? json(event.content_block.input)
                        : "",
                });
            } else if (event.content_block?.type === "thinking") {
                thinkingBlocks.set(Number(event.index), {
                    signature: String(event.content_block.signature ?? ""),
                    redacted: false,
                });
                if (typeof event.content_block.thinking === "string" && event.content_block.thinking) {
                    yield { type: "reasoning-delta", text: event.content_block.thinking };
                }
            } else if (event.content_block?.type === "redacted_thinking") {
                thinkingBlocks.set(Number(event.index), {
                    signature: String(event.content_block.data ?? ""),
                    redacted: true,
                });
                yield { type: "reasoning-delta", text: "[Reasoning redacted]" };
            }
        } else if (type === "content_block_delta") {
            const delta = event.delta;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
                yield { type: "text-delta", text: delta.text };
            } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
                yield { type: "reasoning-delta", text: delta.thinking };
            } else if (delta?.type === "input_json_delta") {
                const block = toolBlocks.get(Number(event.index));
                if (block) block.args += String(delta.partial_json ?? "");
            } else if (delta?.type === "signature_delta") {
                const block = thinkingBlocks.get(Number(event.index));
                if (block) block.signature += String(delta.signature ?? "");
            }
        } else if (type === "content_block_stop") {
            const thinking = thinkingBlocks.get(Number(event.index));
            if (thinking) {
                thinkingBlocks.delete(Number(event.index));
                if (thinking.signature) {
                    yield {
                        type: "part-metadata",
                        target: "reasoning",
                        providerMetadata: {
                            anthropic: {
                                thinkingSignature: thinking.signature,
                                ...(thinking.redacted ? { redacted: true } : {}),
                            },
                        },
                    };
                }
            }
            const block = toolBlocks.get(Number(event.index));
            if (block) {
                toolBlocks.delete(Number(event.index));
                yield { type: "tool-call", toolCallId: block.id, toolName: block.name, input: parseToolArguments(block.args) };
            }
        } else if (type === "message_delta") {
            stopReason = event.delta?.stop_reason ?? stopReason;
            latestUsage = { ...latestUsage, ...(anthropicUsage(event.usage) ?? {}) };
        } else if (type === "message_stop") {
            if (Object.keys(latestUsage).length > 0) yield { type: "usage", usage: latestUsage };
            terminal = true;
            yield { type: "finish", reason: mapFinishReason(stopReason) };
        } else if (type === "error") {
            throw new Error("Anthropic stream failed");
        }
    }
    if (!terminal) throw new Error("Anthropic stream ended without message_stop");
}

function openAIChatMessages(
    messages: NativeModelMessage[],
    options: { includeAssistantReasoning?: boolean } = {},
) {
    const output: any[] = [];
    for (const message of messages) {
        if (message.role === "tool") {
            for (const item of message.content) {
                if (item.type !== "tool-result") continue;
                output.push({
                    role: "tool",
                    tool_call_id: item.toolCallId,
                    content: typeof item.output === "string" ? item.output : json(item.output),
                });
            }
            continue;
        }
        const texts = message.content.filter((item) => item.type === "text").map((item) => item.text);
        const reasoning = message.content
            .filter((item) => item.type === "reasoning")
            .map((item) => item.text);
        const calls = message.content.filter((item) => item.type === "tool-call");
        const includeReasoning = options.includeAssistantReasoning
            && message.role === "assistant"
            && reasoning.length > 0
            && calls.length > 0;
        if (texts.length === 0 && calls.length === 0 && !includeReasoning) continue;
        output.push({
            role: message.role,
            content: texts.length > 0 ? texts.join("\n") : null,
            ...(includeReasoning ? { reasoning_content: reasoning.join("\n") } : {}),
            ...(calls.length > 0 ? {
                tool_calls: calls.map((call) => ({
                    id: call.toolCallId,
                    type: "function",
                    function: { name: call.toolName, arguments: json(call.input) },
                })),
            } : {}),
        });
    }
    return output;
}

async function* streamOpenAIChat(
    model: ResolvedModel,
    request: NativeModelRequest,
    options: ProviderExecutionOptions,
): AsyncGenerator<ProviderStreamEvent> {
    const stable = getStablePrefix(model, request);
    const body = {
        model: model.modelId,
        messages: [
            { role: "system", content: stable.system },
            ...openAIChatMessages(request.messages, {
                // DeepSeek thinking-mode Tool Calls require the assistant's
                // reasoning_content to be replayed verbatim on continuation.
                // Keeping it also preserves the model-output cache prefix.
                includeAssistantReasoning: model.provider === "deepseek",
            }),
        ],
        tools: stable.tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
        })),
        stream: true,
        stream_options: { include_usage: true },
        ...(request.maxOutputTokens != null ? { max_tokens: request.maxOutputTokens } : {}),
        ...(request.temperature != null ? { temperature: request.temperature } : {}),
        ...(model.modelOptions?.reasoningEffort ? { reasoning_effort: model.modelOptions.reasoningEffort } : {}),
    };
    const chatLastToolResult = lastNativeToolResult(request.messages);
    yield {
        type: "cache-diagnostic",
        renderedPrefix: createRenderedPrefixDigest({
            renderedPrefix: { messages: body.messages, tools: body.tools },
            breakpointKind: chatLastToolResult ? "tool-batch" : "conversation",
            ...(chatLastToolResult ? { breakpointId: chatLastToolResult.toolCallId } : {}),
        }),
    };
    const wireBodyText = JSON.stringify(body);
    await recordProviderRequestContext({ model, request, wireBodyText });
    const response = await fetchProvider({
        url: model.endpoint,
        init: { method: "POST", headers: authHeaders(model), body: wireBodyText },
        ...options,
    });
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let terminal = false;
    for await (const frame of parseSSE(response.body, options.signal, options.timeoutMs ?? 120_000)) {
        if (!frame.data) continue;
        if (frame.data === "[DONE]") {
            if (!terminal) {
                for (const call of calls.values()) {
                    yield { type: "tool-call", toolCallId: call.id, toolName: call.name, input: parseToolArguments(call.args) };
                }
                yield { type: "finish", reason: calls.size > 0 ? "tool-calls" : "stop" };
                terminal = true;
            }
            continue;
        }
        let chunk: any;
        try { chunk = JSON.parse(frame.data); } catch { throw new Error("OpenAI-compatible provider returned malformed SSE JSON"); }
        const usage = model.provider === "deepseek"
            ? deepSeekUsage(chunk.usage)
            : openAIUsage(chunk.usage);
        if (usage) yield { type: "usage", usage };
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string" && delta.content) yield { type: "text-delta", text: delta.content };
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoning === "string" && reasoning) yield { type: "reasoning-delta", text: reasoning };
        for (const toolDelta of delta.tool_calls ?? []) {
            const index = Number(toolDelta.index ?? 0);
            const current = calls.get(index) ?? { id: "", name: "", args: "" };
            if (toolDelta.id) current.id = toolDelta.id;
            if (toolDelta.function?.name) current.name += toolDelta.function.name;
            if (toolDelta.function?.arguments) current.args += toolDelta.function.arguments;
            calls.set(index, current);
        }
        if (choice.finish_reason) {
            for (const call of calls.values()) {
                yield { type: "tool-call", toolCallId: call.id, toolName: call.name, input: parseToolArguments(call.args) };
            }
            calls.clear();
            terminal = true;
            yield { type: "finish", reason: mapFinishReason(choice.finish_reason) };
        }
    }
    if (!terminal) throw new Error("OpenAI-compatible stream ended without a terminal marker");
}

function googleMajorVersion(modelId: string) {
    const match = modelId.toLowerCase().match(/^gemini(?:-live)?-(\d+)/);
    return match ? Number.parseInt(match[1]!, 10) : undefined;
}

function googleRequiresToolCallId(modelId: string) {
    const major = googleMajorVersion(modelId);
    return major != null && major >= 3;
}

function googleContents(messages: NativeModelMessage[], modelId: string) {
    const output: any[] = [];
    const includeToolCallId = googleRequiresToolCallId(modelId);
    for (const message of messages) {
        if (message.role === "system") continue;
        const role = message.role === "assistant" ? "model" : "user";
        const parts: any[] = [];
        for (const item of message.content) {
            if (item.type === "text") {
                const thoughtSignature = providerMetadataString(item.providerMetadata, "google", "thoughtSignature");
                parts.push({ text: item.text, ...(thoughtSignature ? { thoughtSignature } : {}) });
            } else if (item.type === "reasoning") {
                const thoughtSignature = providerMetadataString(item.providerMetadata, "google", "thoughtSignature");
                if (thoughtSignature) {
                    parts.push({ thought: true, text: item.text, thoughtSignature });
                }
            } else if (item.type === "tool-call") {
                const thoughtSignature = providerMetadataString(item.providerMetadata, "google", "thoughtSignature");
                parts.push({
                    functionCall: {
                        name: item.toolName,
                        args: item.input,
                        ...(includeToolCallId ? { id: item.toolCallId } : {}),
                    },
                    ...(thoughtSignature ? { thoughtSignature } : {}),
                });
            }
            else if (item.type === "tool-result") {
                parts.push({
                    functionResponse: {
                        name: item.toolName,
                        response: normalizeGoogleToolResponse(item.output, item.isError),
                        ...(includeToolCallId ? { id: item.toolCallId } : {}),
                    },
                });
            }
        }
        if (parts.length === 0) continue;
        const previous = output.at(-1);
        if (previous?.role === role) previous.parts.push(...parts);
        else output.push({ role, parts });
    }
    return output;
}

function normalizeGoogleToolResponse(output: unknown, isError?: boolean) {
    if (output && typeof output === "object" && !Array.isArray(output)) {
        return isError ? { error: output } : output;
    }
    return isError ? { error: output } : { result: output };
}

async function* streamGoogle(
    model: ResolvedModel,
    request: NativeModelRequest,
    options: ProviderExecutionOptions,
): AsyncGenerator<ProviderStreamEvent> {
    const stable = getStablePrefix(model, request);
    const body = {
        systemInstruction: { parts: [{ text: stable.system }] },
        contents: googleContents(request.messages, model.modelId),
        tools: stable.tools.length > 0 ? [{
            functionDeclarations: stable.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                // Gemini's native API accepts full JSON Schema through
                // parametersJsonSchema. Using the legacy `parameters` field
                // would constrain us to Google's OpenAPI-style schema subset.
                parametersJsonSchema: tool.inputSchema,
            })),
        }] : undefined,
        generationConfig: {
            ...(request.maxOutputTokens != null ? { maxOutputTokens: request.maxOutputTokens } : {}),
            ...(request.temperature != null ? { temperature: request.temperature } : {}),
        },
    };
    const googleLastToolResult = lastNativeToolResult(request.messages);
    yield {
        type: "cache-diagnostic",
        renderedPrefix: createRenderedPrefixDigest({
            renderedPrefix: {
                systemInstruction: body.systemInstruction,
                contents: body.contents,
                tools: body.tools,
            },
            breakpointKind: googleLastToolResult ? "tool-batch" : "conversation",
            ...(googleLastToolResult ? { breakpointId: googleLastToolResult.toolCallId } : {}),
        }),
    };
    const wireBodyText = JSON.stringify(body);
    await recordProviderRequestContext({ model, request, wireBodyText });
    const response = await fetchProvider({
        url: model.endpoint,
        init: { method: "POST", headers: authHeaders(model), body: wireBodyText },
        ...options,
    });
    let terminal = false;
    for await (const frame of parseSSE(response.body, options.signal, options.timeoutMs ?? 120_000)) {
        if (!frame.data) continue;
        let chunk: any;
        try { chunk = JSON.parse(frame.data); } catch { throw new Error("Google Generative AI returned malformed SSE JSON"); }
        const usage = googleUsage(chunk.usageMetadata);
        if (usage) yield { type: "usage", usage };
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
            if (typeof part.text === "string" && part.text) {
                if (part.thought === true) yield { type: "reasoning-delta", text: part.text };
                else yield { type: "text-delta", text: part.text };
                if (typeof part.thoughtSignature === "string" && part.thoughtSignature) {
                    yield {
                        type: "part-metadata",
                        target: part.thought === true ? "reasoning" : "text",
                        providerMetadata: { google: { thoughtSignature: part.thoughtSignature } },
                    };
                }
            }
            if (part.functionCall?.name) {
                yield {
                    type: "tool-call",
                    toolCallId: String(part.functionCall.id ?? `google-${crypto.randomUUID()}`),
                    toolName: String(part.functionCall.name),
                    input: structuredClone(part.functionCall.args ?? {}),
                    ...(typeof part.thoughtSignature === "string" && part.thoughtSignature
                        ? { providerMetadata: { google: { thoughtSignature: part.thoughtSignature } } }
                        : {}),
                };
            }
        }
        if (candidate?.finishReason) {
            terminal = true;
            yield { type: "finish", reason: mapFinishReason(candidate.finishReason) };
        }
    }
    if (!terminal) throw new Error("Google Generative AI stream ended without a finish reason");
}

function parseToolArguments(value: string) {
    if (!value.trim()) return {};
    try { return JSON.parse(value); } catch { throw new Error("Provider returned malformed tool-call JSON arguments"); }
}

export function streamProvider(
    model: ResolvedModel,
    request: NativeModelRequest,
    options: ProviderExecutionOptions = {},
): AsyncIterable<ProviderStreamEvent> {
    switch (model.protocol) {
        case "openai-responses": return streamOpenAIResponses(model, request, options);
        case "anthropic-messages": return streamAnthropic(model, request, options);
        case "openai-chat-completions": return streamOpenAIChat(model, request, options);
        case "google-generative-ai": return streamGoogle(model, request, options);
    }
}

export async function generateProviderText(
    model: ResolvedModel,
    request: NativeModelRequest,
    options: ProviderExecutionOptions = {},
) {
    let text = "";
    let usage: ProviderUsage | undefined;
    for await (const event of streamProvider(model, request, options)) {
        if (event.type === "text-delta") text += event.text;
        else if (event.type === "usage") usage = { ...usage, ...event.usage };
    }
    return { text, usage };
}
