import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
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
 * Real runtime factory mirroring production, used to exercise loaded
 * sessions. Pins a reasoning model so `setThinkingLevel` is not clamped to
 * "off" by the default (non-reasoning) model.
 */
const realFactory: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  agentDir,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd, agentDir });
  const result = await createAgentSessionFromServices({
    services,
    sessionManager,
    sessionStartEvent,
    model: getModel("anthropic", "claude-opus-4-5"),
  });
  return { ...result, services, diagnostics: services.diagnostics };
};

/** Redirect the session storage dir so tests never touch the real ~/.pi/agent. */
function withAgentDir(agentDir: string, fn: () => Promise<void>): Promise<void> {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return fn().finally(() => {
    if (previous === undefined) {
      // Assignment would store the string "undefined"; delete to unset.
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  });
}

/**
 * Create a persisted session and return its id and file path. Uses the
 * default session dir (under the current PI_CODING_AGENT_DIR) when
 * `sessionDir` is omitted. Session files are only written once an assistant
 * message arrives, so append a user message followed by an assistant reply.
 */
function createSession(cwd: string, sessionDir?: string): { id: string; file: string } {
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

describe("AgentSessionContainer.currentInfoList", () => {
  it("lists persisted sessions with their persisted info when no runtime is loaded", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        const { id } = createSession(cwd);

        const container = AgentSessionContainer.withFactory(noopFactory);
        const sessions = await container.currentInfoList();
        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
          id,
          cwd,
          name: null,
          firstMessage: "hello",
          messageCount: 2,
          model: null,
          thinkingLevel: "medium",
          isStreaming: false,
          isCompacting: false,
        });
        expect(sessions[0].timestamp).toBeGreaterThan(0);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers live session state for sessions with a loaded runtime", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        // A persisted session, loaded by the container afterwards.
        const { id } = createSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(id, { cwd });
        expect(session).not.toBeNull();
        session!.setThinkingLevel("high");

        const sessions = await container.currentInfoList();
        const info = sessions.find((entry) => entry.id === id)!;
        expect(info).toMatchObject({
          cwd,
          firstMessage: "hello",
          messageCount: 2,
          thinkingLevel: "high",
          isStreaming: false,
          isCompacting: false,
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never force-loads a runtime", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        createSession(cwd);

        // The factory throws, so currentInfoList() would fail if it loaded runtimes.
        const container = AgentSessionContainer.withFactory(noopFactory);
        const sessions = await container.currentInfoList();
        expect(sessions).toHaveLength(1);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("AgentSessionContainer.currentInfo", () => {
  it("returns null for sessions without a loaded runtime", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        const { id } = createSession(cwd);

        const container = AgentSessionContainer.withFactory(noopFactory);
        expect(await container.currentInfo(id)).toBeNull();
        expect(await container.currentInfo("missing")).toBeNull();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns live state for sessions with a loaded runtime", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = createSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(id, { cwd });
        session!.setThinkingLevel("low");

        const info = await container.currentInfo(id);
        expect(info).toMatchObject({ id, thinkingLevel: "low" });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("AgentSessionContainer.delete", () => {
  it("deletes a persisted session so it disappears from the listing", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        const sessionDir = path.join(root, "sessions");
        const { id, file } = createSession(cwd, sessionDir);
        expect(existsSync(file)).toBe(true);

        const container = AgentSessionContainer.withFactory(noopFactory);
        await container.delete(id, { cwd, sessionDir });

        expect(existsSync(file)).toBe(false);
        expect(await SessionManager.list(cwd, sessionDir)).toEqual([]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("broadcasts session_deleted only after the file deletion succeeded", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        const sessionDir = path.join(root, "sessions");
        const { id } = createSession(cwd, sessionDir);

        const container = AgentSessionContainer.withFactory(noopFactory);
        const events: Array<{ sessionId: string; event: unknown }> = [];
        container.subscribe((sessionId, event) => events.push({ sessionId, event }));

        await container.delete(id, { cwd, sessionDir });
        expect(events).toEqual([{ sessionId: id, event: { type: "session_deleted" } }]);

        // A failed deletion (unknown session) must not broadcast.
        await expect(container.delete("missing-id", { cwd, sessionDir })).rejects.toThrow(
          'Session "missing-id" not found',
        );
        expect(events).toHaveLength(1);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when the session does not exist", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        const sessionDir = path.join(root, "sessions");
        const container = AgentSessionContainer.withFactory(noopFactory);

        await expect(container.delete("missing-id", { cwd, sessionDir })).rejects.toThrow(
          'Session "missing-id" not found',
        );
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
