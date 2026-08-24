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
import { SessionViewStateRepository } from "./session-view-state";
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

describe("AgentSessionContainer.findSessionCwd", () => {
  it("reads the cwd from persisted headers without loading a runtime", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        const { id } = createSession(cwd);

        // The factory throws, so findSessionCwd() would fail if it loaded runtimes.
        const container = AgentSessionContainer.withFactory(noopFactory);
        expect(await container.findSessionCwd(id)).toBe(cwd);
        expect(await container.findSessionCwd("missing")).toBeNull();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers the loaded runtime's cwd", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = createSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        await container.get(id, { cwd });

        expect(await container.findSessionCwd(id)).toBe(cwd);
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

describe("shared display cursor (view state)", () => {
  /** A session with two turns at fixed timestamps: keys user:0, assistant:0, user:1, assistant:1. */
  function twoTurnSession(cwd: string): SessionManager {
    const sm = SessionManager.create(cwd);
    appendUser(sm, "hello", 0);
    appendAssistant(sm, "reply 1", 0);
    appendUser(sm, "second", 1);
    appendAssistant(sm, "reply 2", 1);
    return sm;
  }

  it("computes the latest message key from persisted messages and derives isRead", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        await container.get(sm.getSessionId(), { cwd });

        // No stored cursor (nobody displayed anything): the session is
        // treated as fully read.
        const state = await container.getSessionReadState(sm.getSessionId());
        expect(state).toEqual({
          lastDisplayedMessageKey: null,
          latestMessageKey: "assistant:1",
          isRead: true,
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("computes the latest key from persisted entries when the runtime is not loaded", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(noopFactory);
        const state = await container.getSessionReadState(sm.getSessionId(), { cwd });
        expect(state).not.toBeNull();
        expect(state!.latestMessageKey).toBe("assistant:1");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not count an in-flight assistant partial as the latest read target", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);
        const id = sm.getSessionId();

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(id, { cwd });
        expect(session).not.toBeNull();
        const handle = container as unknown as {
          handleSessionEvent(sessionId: string, event: AgentSessionEvent): void;
        };
        handle.handleSessionEvent(id, { type: "turn_start" });
        handle.handleSessionEvent(id, {
          type: "message_start",
          message: {
            role: "assistant",
            content: [],
            api: "anthropic-messages",
            provider: "anthropic",
            model: "test-model",
            usage: usage(),
            stopReason: "stop",
            timestamp: 9999,
          },
        });

        // The streaming partial is rendered but not yet final: it must not
        // become the latest read target (or be markable as displayed).
        const state = await container.getSessionReadState(id);
        expect(state!.latestMessageKey).toBe("assistant:1");
        const rejected = await container.markMessageDisplayed(id, "assistant:9999");
        expect(rejected.lastDisplayedMessageKey).toBeNull();

        // message_end settles it: it becomes the latest and can be marked.
        handle.handleSessionEvent(id, {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "final" }],
            api: "anthropic-messages",
            provider: "anthropic",
            model: "test-model",
            usage: usage(),
            stopReason: "stop",
            timestamp: 9999,
          },
        });
        const settled = await container.getSessionReadState(id);
        expect(settled!.latestMessageKey).toBe("assistant:9999");
        const accepted = await container.markMessageDisplayed(id, "assistant:9999");
        expect(accepted.lastDisplayedMessageKey).toBe("assistant:9999");
        expect(accepted.isRead).toBe(true);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("advances the cursor through markMessageDisplayed and broadcasts view_state", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);
        const id = sm.getSessionId();

        const container = AgentSessionContainer.withFactory(realFactory);
        const events: Array<{ sessionId: string; event: unknown }> = [];
        container.subscribe((sessionId, event) => events.push({ sessionId, event }));
        await container.get(id, { cwd });

        const afterUser = await container.markMessageDisplayed(id, "user:0");
        expect(afterUser.isRead).toBe(false);
        expect(events).toEqual([
          { sessionId: id, event: { type: "view_state", viewState: afterUser } },
        ]);

        const afterAssistant = await container.markMessageDisplayed(id, "assistant:1");
        expect(afterAssistant.isRead).toBe(true);
        expect(events).toHaveLength(2);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unknown message keys without advancing or broadcasting", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);
        const id = sm.getSessionId();

        const container = AgentSessionContainer.withFactory(realFactory);
        const events: unknown[] = [];
        container.subscribe((_sid, event) => events.push(event));
        await container.get(id, { cwd });

        const state = await container.markMessageDisplayed(id, "assistant:missing");
        expect(state.lastDisplayedMessageKey).toBeNull();
        expect(events).toEqual([]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never moves the cursor backwards for a stale client", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);
        const id = sm.getSessionId();

        const container = AgentSessionContainer.withFactory(realFactory);
        await container.get(id, { cwd });
        await container.markMessageDisplayed(id, "assistant:1");

        // A stale client reports an earlier message: ignored, and no broadcast.
        const events: unknown[] = [];
        container.subscribe((_sid, event) => events.push(event));
        const state = await container.markMessageDisplayed(id, "user:0");
        expect(state.lastDisplayedMessageKey).toBe("assistant:1");
        expect(state.isRead).toBe(true);
        expect(events).toEqual([]);

        // A repeated key is an idempotent no-op.
        const again = await container.markMessageDisplayed(id, "assistant:1");
        expect(again.lastDisplayedMessageKey).toBe("assistant:1");
        expect(events).toEqual([]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the saved cursor when the projection compacted it away", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = compactedSession(cwd);
        const id = sm.getSessionId();

        const repo = new SessionViewStateRepository();
        // A cursor from before the compaction: not present in the projection.
        repo.set(id, "assistant:1000");
        const container = AgentSessionContainer.withFactory(realFactory, repo);

        const state = await container.getSessionReadState(id, { cwd });
        expect(state!.lastDisplayedMessageKey).toBe("assistant:1000");
        // The cursor points at a compacted message: no valid restoration
        // target, so the session is conservatively unread until a client
        // observes a current message.
        expect(state!.isRead).toBe(false);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not mark a running tool result as displayed until tool_execution_end", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);
        const id = sm.getSessionId();

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(id, { cwd });
        expect(session).not.toBeNull();
        const handle = container as unknown as {
          handleSessionEvent(sessionId: string, event: AgentSessionEvent): void;
        };
        handle.handleSessionEvent(id, { type: "turn_start" });
        handle.handleSessionEvent(id, {
          type: "tool_execution_start",
          toolCallId: "call-1",
          toolName: "bash",
          args: { command: "ls" },
        });

        // The running tool shows a placeholder, but its result is not final:
        // it must not become the latest read target or be markable.
        const running = await container.getSessionReadState(id);
        expect(running!.latestMessageKey).toBe("assistant:1");
        const rejected = await container.markMessageDisplayed(id, "toolResult:call-1");
        expect(rejected.lastDisplayedMessageKey).toBeNull();

        // tool_execution_end settles it.
        handle.handleSessionEvent(id, {
          type: "tool_execution_end",
          toolCallId: "call-1",
          toolName: "bash",
          result: { content: [{ type: "text", text: "done" }] },
          isError: false,
        });
        const settled = await container.getSessionReadState(id);
        expect(settled!.latestMessageKey).toBe("toolResult:call-1");
        const accepted = await container.markMessageDisplayed(id, "toolResult:call-1");
        expect(accepted.lastDisplayedMessageKey).toBe("toolResult:call-1");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks a session unread when a message settles without any client viewing it", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);
        const id = sm.getSessionId();

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(id, { cwd });
        expect(session).not.toBeNull();
        const handle = container as unknown as {
          handleSessionEvent(sessionId: string, event: AgentSessionEvent): void;
        };

        // A message settles while the session was never opened as a page (no
        // view-state record yet, e.g. a prompt sent through a fetcher): the
        // session must become unread.
        handle.handleSessionEvent(id, { type: "turn_start" });
        handle.handleSessionEvent(id, {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "new answer" }],
            api: "anthropic-messages",
            provider: "anthropic",
            model: "test-model",
            usage: usage(),
            stopReason: "stop",
            timestamp: 9999,
          },
        });

        const state = await container.getSessionReadState(id);
        expect(state).toEqual({
          lastDisplayedMessageKey: null,
          latestMessageKey: "assistant:9999",
          isRead: false,
        });

        // Once a client displays the new message it becomes read.
        const marked = await container.markMessageDisplayed(id, "assistant:9999");
        expect(marked.isRead).toBe(true);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes the view state when the session is deleted", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = SessionManager.create(cwd);
        appendUser(sm, "hello", 0);
        appendAssistant(sm, "reply", 0);
        const id = sm.getSessionId();

        const repo = new SessionViewStateRepository();
        const container = AgentSessionContainer.withFactory(realFactory, repo);
        await container.get(id, { cwd });
        await container.markMessageDisplayed(id, "user:0");
        expect(repo.get(id)).not.toBeNull();

        await container.delete(id, { cwd });
        expect(repo.get(id)).toBeNull();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains the view state when deletion fails", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = SessionManager.create(cwd);
        appendUser(sm, "hello", 0);
        appendAssistant(sm, "reply", 0);
        const id = sm.getSessionId();

        const repo = new SessionViewStateRepository();
        const container = AgentSessionContainer.withFactory(realFactory, repo);
        await container.get(id, { cwd });
        await container.markMessageDisplayed(id, "user:0");

        await expect(container.delete("missing-id", { cwd })).rejects.toThrow();
        expect(repo.get(id)).not.toBeNull();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats sessions without a stored cursor as read via currentInfoList", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(noopFactory);
        const sessions = await container.currentInfoList();
        expect(sessions[0]).toMatchObject({
          id: sm.getSessionId(),
          lastDisplayedMessageKey: null,
          latestMessageKey: "assistant:1",
          isRead: true,
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports read state through currentInfoList once the cursor reached the latest", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const sm = twoTurnSession(cwd);
        const id = sm.getSessionId();

        const repo = new SessionViewStateRepository();
        const container = AgentSessionContainer.withFactory(realFactory, repo);
        await container.get(id, { cwd });
        await container.markMessageDisplayed(id, "assistant:1");

        const sessions = await container.currentInfoList();
        expect(sessions[0]).toMatchObject({
          id,
          lastDisplayedMessageKey: "assistant:1",
          latestMessageKey: "assistant:1",
          isRead: true,
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
