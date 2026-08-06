import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { AgentSessionContainer } from "./agent-session-container";

/** A runtime factory that is never invoked by the tested paths. */
const noopFactory: CreateAgentSessionRuntimeFactory = async () => {
  throw new Error("runtime factory should not be called");
};

/**
 * Create a persisted session in `sessionDir` and return its id and file path.
 * Session files are only written once an assistant message arrives, so append
 * a user message followed by an assistant reply.
 */
function createSession(cwd: string, sessionDir: string): { id: string; file: string } {
  const sm = SessionManager.create(cwd, sessionDir);
  const timestamp = Date.now();
  sm.appendMessage({ role: "user", content: "hello", timestamp });
  sm.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Hi there!" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  });
  return { id: sm.getSessionId(), file: sm.getSessionFile()! };
}

describe("AgentSessionContainer.delete", () => {
  it("deletes a persisted session so it disappears from the listing", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      const cwd = path.join(root, "cwd");
      const sessionDir = path.join(root, "sessions");
      const { id, file } = createSession(cwd, sessionDir);
      expect(existsSync(file)).toBe(true);

      const container = AgentSessionContainer.withFactory(noopFactory);
      await container.delete(id, { cwd, sessionDir });

      expect(existsSync(file)).toBe(false);
      expect(await SessionManager.list(cwd, sessionDir)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when the session does not exist", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      const cwd = path.join(root, "cwd");
      const sessionDir = path.join(root, "sessions");
      const container = AgentSessionContainer.withFactory(noopFactory);

      await expect(container.delete("missing-id", { cwd, sessionDir })).rejects.toThrow(
        'Session "missing-id" not found',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
