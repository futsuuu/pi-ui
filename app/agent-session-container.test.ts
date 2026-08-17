import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SessionManager,
  type AgentSessionEvent,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { AgentSessionContainer, applyTurnEvent } from "./agent-session-container";
import { createSession, realFactory, withAgentDir } from "./test-helpers";

/** A runtime factory that is never invoked by the tested paths. */
const noopFactory: CreateAgentSessionRuntimeFactory = async () => {
  throw new Error("runtime factory should not be called");
};

function usage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** Append a user message; returns its entry id. */
function appendUser(sm: SessionManager, content: string, timestamp: number): string {
  return sm.appendMessage({ role: "user", content, timestamp });
}

/** Append an assistant reply; returns its entry id. */
function appendAssistant(sm: SessionManager, text: string, timestamp: number): string {
  return sm.appendMessage({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: usage(),
    stopReason: "stop",
    timestamp,
  });
}

/**
 * Append three user/assistant turns, then compact the first turn away by
 * keeping everything from the second turn's user message on. Returns the
 * SessionManager with the compacted persisted history (6 message entries).
 */
function compactedSession(cwd: string): SessionManager {
  const sm = SessionManager.create(cwd);
  appendUser(sm, "hello", 1000);
  appendAssistant(sm, "reply 1", 1000);
  const secondUser = appendUser(sm, "second", 2000);
  appendAssistant(sm, "reply 2", 2000);
  appendUser(sm, "third", 3000);
  appendAssistant(sm, "reply 3", 3000);
  sm.appendCompaction("summary of the first turn", secondUser, 100);
  return sm;
}

/**
 * Append three turns, branch at the second turn's user message, and append
 * an alternative fourth turn on the new branch. Returns the SessionManager
 * with 8 persisted message entries.
 */
function branchedSession(cwd: string): SessionManager {
  const sm = SessionManager.create(cwd);
  appendUser(sm, "hello", 1000);
  appendAssistant(sm, "reply 1", 1000);
  const secondUser = appendUser(sm, "second", 2000);
  appendAssistant(sm, "reply 2", 2000);
  appendUser(sm, "third", 3000);
  appendAssistant(sm, "reply 3", 3000);
  sm.branch(secondUser);
  appendUser(sm, "alternative", 4000);
  appendAssistant(sm, "reply alt", 4000);
  return sm;
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

  it("keeps the persisted title and count for a loaded session after compaction", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        // 6 message entries + a compaction entry summarizing the first turn.
        const sm = compactedSession(cwd);
        expect(sm.getEntries().filter((entry) => entry.type === "message")).toHaveLength(6);

        const container = AgentSessionContainer.withFactory(realFactory);
        // Unloaded: the persisted info drives the list.
        const before = await container.currentInfoList();
        expect(before).toHaveLength(1);
        expect(before[0]).toMatchObject({ firstMessage: "hello", messageCount: 6 });

        // Loading the runtime replaces agent.state.messages with the compacted
        // context; the listed info must not follow it.
        const session = await container.get(before[0].id, { cwd });
        expect(session).not.toBeNull();

        const after = await container.currentInfoList();
        expect(after[0]).toMatchObject({
          firstMessage: before[0].firstMessage,
          messageCount: before[0].messageCount,
          timestamp: before[0].timestamp,
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the persisted title and count for a loaded session after a branch switch", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        // 8 message entries across the original branch and the new one.
        const sm = branchedSession(cwd);
        expect(sm.getEntries().filter((entry) => entry.type === "message")).toHaveLength(8);

        const container = AgentSessionContainer.withFactory(realFactory);
        const before = await container.currentInfoList();
        expect(before[0]).toMatchObject({ firstMessage: "hello", messageCount: 8 });

        const session = await container.get(before[0].id, { cwd });
        expect(session).not.toBeNull();

        const after = await container.currentInfoList();
        expect(after[0]).toMatchObject({
          firstMessage: before[0].firstMessage,
          messageCount: before[0].messageCount,
          timestamp: before[0].timestamp,
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("joins multi-part user messages for firstMessage like the persisted path", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        // Text parts are joined with a space in SessionManager.list; the loaded
        // path must produce the same title for the same entries.
        const sm = SessionManager.create(cwd);
        sm.appendMessage({
          role: "user",
          content: [
            { type: "text", text: "part1" },
            { type: "text", text: "part2" },
          ],
          timestamp: 1000,
        });
        appendAssistant(sm, "reply", 1000);

        const persisted = (await SessionManager.list(cwd))[0];
        expect(persisted.firstMessage).toBe("part1 part2");

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(persisted.id, { cwd });
        expect(session).not.toBeNull();
        const loaded = await container.currentInfo(persisted.id);
        expect(loaded).not.toBeNull();
        expect(loaded!.firstMessage).toBe(persisted.firstMessage);
        expect(loaded!.messageCount).toBe(persisted.messageCount);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips text-less user messages for firstMessage like the persisted path", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        // The first user message has no text blocks: both paths skip it and
        // the next user message with text becomes the title.
        const sm = SessionManager.create(cwd);
        sm.appendMessage({ role: "user", content: [], timestamp: 1000 });
        appendAssistant(sm, "reply", 1000);
        appendUser(sm, "second", 2000);
        appendAssistant(sm, "reply 2", 2000);

        const persisted = (await SessionManager.list(cwd))[0];
        expect(persisted.firstMessage).toBe("second");

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(persisted.id, { cwd });
        expect(session).not.toBeNull();
        const loaded = await container.currentInfo(persisted.id);
        expect(loaded).not.toBeNull();
        expect(loaded!.firstMessage).toBe(persisted.firstMessage);
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

describe("applyTurnEvent (per-session turn buffer)", () => {
  it("starts a buffer on turn_start and appends events until the turn ends", () => {
    let buffer = applyTurnEvent(undefined, { type: "turn_start" });
    expect(buffer).toEqual([{ type: "turn_start" }]);
    buffer = applyTurnEvent(buffer, {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
    });
    expect(buffer).toHaveLength(2);

    // agent_settled clears the buffer: a later turn_start starts fresh.
    expect(applyTurnEvent(buffer, { type: "agent_settled" })).toBeUndefined();
    expect(applyTurnEvent(undefined, { type: "turn_start" })).toEqual([{ type: "turn_start" }]);
  });

  it("coalesces message_update to the newest partial per message identity", () => {
    const start = applyTurnEvent(undefined, { type: "turn_start" })!;
    const firstPartial = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Hel" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test-model",
      usage: usage(),
      stopReason: "stop" as const,
      timestamp: 5,
    };
    const first: AgentSessionEvent = {
      type: "message_update",
      message: firstPartial,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Hel",
        partial: firstPartial,
      },
    };
    const secondPartial = {
      ...firstPartial,
      content: [{ type: "text" as const, text: "Hello" }],
    };
    const second: AgentSessionEvent = {
      type: "message_update",
      message: secondPartial,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Hello",
        partial: secondPartial,
      },
    };
    const thirdPartial = {
      ...firstPartial,
      content: [{ type: "text" as const, text: "Other" }],
      timestamp: 6,
    };
    const third: AgentSessionEvent = {
      type: "message_update",
      message: thirdPartial,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Other",
        partial: thirdPartial,
      },
    };

    const afterFirst = applyTurnEvent(start, first)!;
    const afterSecond = applyTurnEvent(afterFirst, second)!;
    expect(afterSecond).toHaveLength(2); // turn_start + one coalesced update
    expect(afterSecond[1]).toBe(second); // newest partial wins

    // A different message identity appends instead of replacing.
    const afterThird = applyTurnEvent(afterSecond, third)!;
    expect(afterThird).toHaveLength(3);
  });

  it("coalesces tool_execution_update to the newest partial per toolCallId", () => {
    const start = applyTurnEvent(undefined, { type: "turn_start" })!;
    const first: AgentSessionEvent = {
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
      partialResult: { content: [{ type: "text", text: "a" }] },
    };
    const second: AgentSessionEvent = {
      ...first,
      // Tool partials are cumulative: the newest update carries the full
      // accumulated output (bash emits one per ~100ms throttle interval).
      partialResult: { content: [{ type: "text", text: "aaaa…\n…" }] },
    };
    const otherTool: AgentSessionEvent = {
      ...first,
      toolCallId: "call-2",
      partialResult: { content: [{ type: "text", text: "b" }] },
    };

    const afterFirst = applyTurnEvent(start, first)!;
    const afterSecond = applyTurnEvent(afterFirst, second)!;
    expect(afterSecond).toHaveLength(2); // turn_start + one coalesced update
    expect(afterSecond[1]).toBe(second); // newest partial wins

    // A different toolCallId appends instead of replacing.
    const afterOther = applyTurnEvent(afterSecond, otherTool)!;
    expect(afterOther).toHaveLength(3);
    expect(afterOther[1]).toBe(second);
    expect(afterOther[2]).toBe(otherTool);

    // A second update for the first tool is coalesced into its original slot,
    // keeping the relative order with the other tool's events stable.
    const final: AgentSessionEvent = {
      ...first,
      partialResult: { content: [{ type: "text", text: "aaaa…" }] },
    };
    const afterFinal = applyTurnEvent(afterOther, final)!;
    expect(afterFinal).toHaveLength(3);
    expect(afterFinal[1]).toBe(final);
    expect(afterFinal[2]).toBe(otherTool);
  });

  it("ignores events outside a turn (no buffer is created)", () => {
    expect(
      applyTurnEvent(undefined, { type: "thinking_level_changed", level: "high" }),
    ).toBeUndefined();
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
