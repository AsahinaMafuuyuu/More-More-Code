import {
    appendSessionTreeMessages,
    type SessionEntryMetadata,
    type SessionTreeOptions,
    type SessionTreeState,
} from "@more-more-code/harness";
import type { Message } from "./chat-types";

/**
 * Canonicalizes one AI SDK/UI message for durable Session history.
 *
 * This is intentionally narrower than a generic JavaScript serializer:
 * `undefined` is canonicalized only where JSON has an unambiguous absence
 * representation, while values that cannot round-trip losslessly still fail.
 */
export function normalizeDurableMessage(message: Message): Message {
    return normalizeDurableSessionData(message, "Durable message");
}

export function normalizeDurableMessages(messages: readonly Message[]): Message[] {
    return messages.map((message, index) => normalizeDurableSessionData(
        message,
        `Durable messages[${index}]`,
    ));
}

/**
 * The single CLI message-to-Session-Tree append boundary. Callers supply AI
 * SDK/UI messages; only their normalized durable representations reach the
 * provider-independent Harness constructor.
 */
export function appendDurableSessionMessages(
    state: SessionTreeState<Message>,
    messages: readonly Message[],
    metadata: SessionEntryMetadata = {},
    options: SessionTreeOptions<Message> = {},
): SessionTreeState<Message> {
    return appendSessionTreeMessages(
        state,
        normalizeDurableMessages(messages),
        metadata,
        options,
    );
}

/**
 * Shared Session-data policy used by the Tool-terminal adapter for metadata,
 * Tool output, and error details. It is exported only inside the CLI semantic
 * adapter layer so message and Tool persistence cannot drift into two cleanup
 * policies.
 */
export function normalizeDurableSessionData<T>(value: T, label = "Durable Session data"): T {
    return normalizeValue(value, label, new Set<object>()) as T;
}

function normalizeValue(value: unknown, path: string, ancestors: Set<object>): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError(`${path} contains a non-finite number`);
        }
        return value;
    }

    if (typeof value !== "object") {
        throw new TypeError(`${path} must be JSON-safe`);
    }

    if (ancestors.has(value)) {
        throw new TypeError(`${path} contains a cycle and cannot be persisted`);
    }
    ancestors.add(value);

    try {
        if (Object.getOwnPropertySymbols(value).length > 0) {
            throw new TypeError(`${path} contains symbol properties`);
        }

        if (Array.isArray(value)) {
            const result: unknown[] = new Array(value.length);
            for (let index = 0; index < value.length; index += 1) {
                const hasValue = Object.prototype.hasOwnProperty.call(value, index);
                const child = hasValue ? value[index] : undefined;
                result[index] = child === undefined
                    ? null
                    : normalizeValue(child, `${path}[${index}]`, ancestors);
            }
            return result;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${path} contains a non-plain object`);
        }

        const result = Object.create(prototype) as Record<string, unknown>;
        for (const key of Object.keys(value)) {
            const child = (value as Record<string, unknown>)[key];
            if (child === undefined) continue;

            Object.defineProperty(result, key, {
                value: normalizeValue(child, `${path}.${key}`, ancestors),
                enumerable: true,
                configurable: true,
                writable: true,
            });
        }
        return result;
    } finally {
        ancestors.delete(value);
    }
}
