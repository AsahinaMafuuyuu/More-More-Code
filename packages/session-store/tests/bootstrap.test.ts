import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LOCAL_SESSION_STORE_RELATIVE_PATH,
  normalizeLocalSessionStoreDatabaseUrl,
  resolveLocalSessionStoreDatabaseUrl,
} from "../src";

describe("Local Session Store bootstrap", () => {
  test("uses a per-user local database by default and accepts test path injection", async () => {
    const homeDirectory = await mkdtemp(path.join(tmpdir(), "more-more-code-session-home-"));
    try {
      const databaseUrl = resolveLocalSessionStoreDatabaseUrl({ homeDirectory });
      expect(fileURLToPath(databaseUrl)).toBe(path.join(homeDirectory, LOCAL_SESSION_STORE_RELATIVE_PATH));

      const configured = pathToFileURL(path.join(homeDirectory, "configured.db")).href;
      expect(resolveLocalSessionStoreDatabaseUrl({ databaseUrl: configured })).toBe(configured);
    } finally {
      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  test("rejects remote and relative database URLs", () => {
    expect(() => normalizeLocalSessionStoreDatabaseUrl("https://example.com/sessions.db"))
      .toThrow("SQLite file: URL");
    expect(() => normalizeLocalSessionStoreDatabaseUrl("sessions.db"))
      .toThrow("absolute SQLite file URL");
  });
});
