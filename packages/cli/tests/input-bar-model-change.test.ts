import { describe, expect, test } from "bun:test";
import { commitPromptModelChange } from "../src/components/input-bar";

const model = { providerId: "local", modelId: "durable-model" };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("InputBar model selection", () => {
  test("does not update prompt model until the authority model_change commit resolves", async () => {
    const commit = deferred();
    const selected: string[] = [];
    const pending = commitPromptModelChange({
      model,
      onModelChange: () => commit.promise,
      setModel: (next) => selected.push(`${next.providerId}/${next.modelId}`),
    });

    await Promise.resolve();
    expect(selected).toEqual([]);
    commit.resolve();
    await pending;
    expect(selected).toEqual(["local/durable-model"]);
  });

  test("propagates a rejected authority commit without changing prompt model", async () => {
    const selected: string[] = [];

    await expect(commitPromptModelChange({
      model,
      onModelChange: async () => {
        throw new Error("local model_change commit rejected");
      },
      setModel: (next) => selected.push(next.modelId),
    })).rejects.toThrow("local model_change commit rejected");

    expect(selected).toEqual([]);
  });
});
