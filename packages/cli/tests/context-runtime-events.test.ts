import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bootstrapAgentEnvironment } from "../src/lib/agent-environment";
import {
  LocalModelTransport,
  type ContextProjectionLifecycleEvent,
} from "../src/lib/local-model-transport";
import type { Message } from "../src/lib/chat-types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Context Runtime Events", () => {
  test("awaits content-free lifecycle metrics around manual projection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-context-events-"));
    temporaryDirectories.push(root);
    await bootstrapAgentEnvironment({
      globalHome: path.join(root, "home"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const events: ContextProjectionLifecycleEvent[] = [];
    const transport = new LocalModelTransport({
      async onContextEvent(event) {
        events.push(structuredClone(event));
      },
    });
    const secret = "TOP-SECRET-PROMPT";
    const model = { providerId: "openai", modelId: "gpt-5.5" } as const;
    const messages: Message[] = [{
      id: "message-one",
      role: "user",
      parts: [{ type: "text", text: secret }],
      metadata: { mode: "PLAN", model },
    }];

    const outcome = await transport.compactContext({
      messages,
      mode: "PLAN",
      model,
    });

    expect(outcome.status).toBe("noop");
    expect(events.map((event) => event.phase)).toEqual(["started", "completed"]);
    expect(events[0]?.operationId).toBe(events[1]?.operationId);
    expect(JSON.stringify(events)).not.toContain(secret);
  });
});
