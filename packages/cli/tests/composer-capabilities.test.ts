import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findActiveMention,
  replaceActiveMention,
} from "../src/ui/session/composer/mention-model";
import {
  commandToComposerIntent,
  type ComposerIntent,
} from "../src/ui/session/composer/composer-intent";
import { searchMentionCandidates } from "../src/ui/session/composer/mention-search";

describe("Composer capabilities", () => {
  test("mention parsing is cursor-aware and does not treat email text as a file mention", () => {
    expect(findActiveMention("review @src/index.ts please", 18)).toEqual({
      start: 7,
      end: 20,
      query: "src/index.ts",
    });
    expect(findActiveMention("mail dev@example.com", 16)).toBeNull();
    expect(findActiveMention("(@src/app.ts),", 8)).toEqual({
      start: 1,
      end: 12,
      query: "src/app.ts",
    });
  });

  test("mention insertion preserves surrounding editor text and advances the cursor", () => {
    expect(replaceActiveMention({
      text: "open @src/ now",
      mention: { start: 5, end: 10, query: "src/" },
      candidate: { path: "src/index.ts", kind: "file" },
    })).toEqual({
      text: "open @src/index.ts  now",
      cursorOffset: 19,
    });
  });

  test("command selection becomes data-only ComposerIntent", () => {
    const intent: ComposerIntent = commandToComposerIntent({
      name: "compact",
      value: "/compact",
      description: "Compact context",
    });
    expect(intent).toEqual({
      type: "command",
      commandName: "compact",
      commandValue: "/compact",
    });
  });

  test("mention search stays inside workspace and hides dot entries unless explicitly requested", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-composer-"));
    try {
      await mkdir(path.join(root, "src"));
      await writeFile(path.join(root, "src", "index.ts"), "export {}\n");
      await writeFile(path.join(root, ".secret"), "secret\n");

      expect(await searchMentionCandidates("src/i", root)).toEqual([
        { path: "src/index.ts", kind: "file" },
      ]);
      expect(await searchMentionCandidates("..", root)).toEqual([]);
      expect((await searchMentionCandidates("", root)).some((item) => item.path === ".secret")).toBe(false);
      expect(await searchMentionCandidates(".s", root)).toContainEqual({ path: ".secret", kind: "file" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
