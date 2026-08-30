import {
  SESSION_TREE_VERSION,
  isSessionTreeState,
  projectSessionEntryPath,
  projectSessionTreeMessages,
  type SessionEntry,
  type SessionTreeState,
} from "@more-more-code/harness";
import { LocalSessionStoreError } from "./errors";
import type { LocalSessionMetadata } from "./types";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Canonical JSON gives entry comparisons stable semantics independent of object
 * key insertion order. The store deliberately rejects values that SQLite JSON
 * cannot round-trip losslessly.
 */
export function canonicalizeJson(value: unknown, label: string): string {
  return JSON.stringify(normalizeJson(value, label, new Set<object>()));
}

export function parseCanonicalJson(serialized: string, label: string): JsonValue {
  try {
    return normalizeJson(JSON.parse(serialized) as unknown, label, new Set<object>());
  } catch (error) {
    if (error instanceof LocalSessionStoreError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new LocalSessionStoreError(`${label} contained invalid JSON: ${message}`, { cause: error });
  }
}

export function cloneJson<T>(value: T, label: string): T {
  return parseCanonicalJson(canonicalizeJson(value, label), label) as T;
}

export function normalizeMetadata(value: unknown, label = "Local Session metadata"): LocalSessionMetadata {
  const cloned = cloneJson(value, label);
  if (!isRecord(cloned)) {
    throw new LocalSessionStoreError(`${label} must be a JSON object`);
  }
  return cloned;
}

export function normalizeSessionTreeState<TMessage>(
  value: SessionTreeState<TMessage>,
): SessionTreeState<TMessage> {
  const cloned = cloneJson(value, "Session Tree state");

  if (!isSessionTreeState(cloned)) {
    throw new LocalSessionStoreError("Session Tree state does not satisfy the Harness v3 contract");
  }
  if (cloned.version !== SESSION_TREE_VERSION) {
    throw new LocalSessionStoreError(`Unsupported Session Tree version: ${String(cloned.version)}`);
  }
  if (!isNonEmptyString(cloned.rootEntryId) || !isNonEmptyString(cloned.activeEntryId)) {
    throw new LocalSessionStoreError("Session Tree rootEntryId and activeEntryId must be non-empty strings");
  }

  const seen = new Set<string>();
  for (const entry of cloned.entries) {
    if (!isNonEmptyString(entry.id)) {
      throw new LocalSessionStoreError("Session Tree entry id must be a non-empty string");
    }
    if (seen.has(entry.id)) {
      throw new LocalSessionStoreError(`Duplicate Session Tree entry ${entry.id}`);
    }
    seen.add(entry.id);
    if (!Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0) {
      throw new LocalSessionStoreError(`Session Tree entry ${entry.id} has an invalid createdAt value`);
    }
  }

  try {
    // Harness validates the root, parent topology, branch reachability, and
    // message-update semantics. Project every entry so invalid inactive branch
    // state cannot hide behind the currently active branch.
    for (const entry of cloned.entries) {
      projectSessionEntryPath(cloned, entry.id);
      projectSessionTreeMessages(cloned, entry.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LocalSessionStoreError(`Invalid Session Tree topology: ${message}`, { cause: error });
  }

  return cloned as SessionTreeState<TMessage>;
}

export function canonicalEntry<TMessage>(entry: SessionEntry<TMessage>): string {
  return canonicalizeJson(entry, `Session Tree entry ${entry.id}`);
}

function normalizeJson(value: unknown, label: string, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LocalSessionStoreError(`${label} contains a non-finite number`);
    }
    return value;
  }

  if (typeof value !== "object") {
    throw new LocalSessionStoreError(`${label} must be JSON-safe`);
  }

  if (ancestors.has(value)) {
    throw new LocalSessionStoreError(`${label} contains a cycle and cannot be persisted`);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => normalizeJson(item, `${label}[${index}]`, ancestors));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new LocalSessionStoreError(`${label} contains a non-plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new LocalSessionStoreError(`${label} contains symbol properties`);
    }

    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      // Defining rather than assigning keeps an untrusted "__proto__" key
      // as JSON data instead of changing the result object's prototype.
      Object.defineProperty(result, key, {
        value: normalizeJson(
          (value as Record<string, unknown>)[key],
          `${label}.${key}`,
          ancestors,
        ),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
