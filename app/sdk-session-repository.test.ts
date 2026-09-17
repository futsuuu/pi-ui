import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SdkSessionRepository } from "./sdk-session-repository";
import { oneTurnSession, withAgentDir } from "./test-helpers";

describe("SdkSessionRepository", () => {
  it("reads a durable session without an execution runtime", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-sdk-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);
        const repository = new SdkSessionRepository();

        const snapshot = await repository.read(id, { cwd });

        expect(snapshot).toMatchObject({
          id,
          cwd,
          state: {
            model: { provider: "anthropic", id: "test-model", name: "test-model" },
            isStreaming: false,
            isCompacting: false,
            contextUsage: null,
          },
        });
        expect(snapshot?.messages).toHaveLength(2);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists summaries and resolves a session working directory", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-sdk-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);
        const repository = new SdkSessionRepository();

        expect(await repository.listInfo(cwd)).toEqual([
          expect.objectContaining({ id, firstMessage: "hello", messageCount: 2 }),
        ]);
        expect(await repository.findSessionCwd(id)).toBe(cwd);
        expect(await repository.findSessionCwd("missing")).toBeNull();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
