import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const cliRoot = path.resolve(import.meta.dir, "../src");

function source(relativePath: string) {
  return readFileSync(path.join(cliRoot, relativePath), "utf8");
}

describe("UI Architecture Foundation closeout", () => {
  test("removes superseded god hook/component normal paths", () => {
    expect(existsSync(path.join(cliRoot, "hooks/use-chat.ts"))).toBe(false);
    expect(existsSync(path.join(cliRoot, "components/input-bar.tsx"))).toBe(false);
    expect(existsSync(path.join(cliRoot, "components/session-shell.tsx"))).toBe(false);
  });

  test("command metadata has no executable legacy action path", () => {
    const commands = source("components/command-menu/commands.tsx");
    expect(commands).not.toContain("action:");
    expect(commands).not.toContain("shutdownCliEnvironment");
  });

  test("Session screen is route/workspace composition and owns no keyboard semantics", () => {
    const session = source("screens/session.tsx");
    expect(session).not.toContain("useKeyboard(");
    expect(session).not.toContain("resolveInteractionAction");
    expect(session).not.toContain("projectToolUses");
    expect(session).not.toContain("projectAgentActivity");
    expect(session).toContain("SessionWorkspace");
  });

  test("no Session-root presentation timer or arbitrary Composer width remains", () => {
    const session = source("screens/session.tsx");
    const workspace = source("ui/session/workspace/session-workspace.tsx");
    const composer = source("ui/session/composer/composer.tsx");
    expect(session).not.toContain("setInterval(");
    expect(workspace).not.toContain('width="80%"');
    expect(composer).not.toContain('width="80%"');
  });
});
