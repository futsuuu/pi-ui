import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { RouterContextProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSessionContainer } from "~/agent-session-container";
import { agentSessionContainerContext } from "~/router-contexts";
import type { SessionInfo } from "~/session-info";
import { createSession, realFactory, withAgentDir } from "~/test-helpers";

import { loader, type SseEvent } from "./loader";

/** A parsed SSE block: a `data:` message or a comment (keep-alive) line. */
type SseBlock = { kind: "data"; value: SseEvent } | { kind: "comment" };

/** Reads SSE blocks from one connection; a stream only allows a single reader. */
class SseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = "";

  constructor(response: Response) {
    this.reader = response.body!.getReader();
  }

  async read(count: number): Promise<SseBlock[]> {
    const blocks: SseBlock[] = [];
    while (blocks.length < count) {
      // A chunk can deliver a partial SSE block (no \n\n delimiter yet); wait
      // for the next chunk instead of parsing (and looping on) the remainder.
      if (this.buffer.includes("\n\n")) {
        blocks.push(...this.parseBlocks());
        continue;
      }
      const { value, done } = await this.reader.read();
      if (done) break;
      this.buffer += new TextDecoder().decode(value);
    }
    return blocks;
  }

  private parseBlocks(): SseBlock[] {
    const parts = this.buffer.split("\n\n");
    this.buffer = parts.pop() ?? "";
    const blocks: SseBlock[] = [];
    for (const block of parts) {
      const [line] = block.split("\n");
      if (line.startsWith(": ")) {
        blocks.push({ kind: "comment" });
      } else if (line.startsWith("data: ")) {
        blocks.push({ kind: "data", value: JSON.parse(line.slice(6)) as SseEvent });
      }
    }
    return blocks;
  }

  async cancel() {
    await this.reader.cancel();
  }
}

function callLoader(container: AgentSessionContainer): Promise<Response> {
  const context = new RouterContextProvider();
  context.set(agentSessionContainerContext, container);
  return loader({
    request: new Request("http://localhost/events"),
    url: new URL("http://localhost/events"),
    params: {},
    pattern: "/events",
    context,
  });
}

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

/** A session with a known timeline: user:10, assistant:10. */
function oneTurnSession(cwd: string): { id: string } {
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "hello", timestamp: 10 });
  sm.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Hi there!" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: usage(),
    stopReason: "stop",
    timestamp: 10,
  });
  return { id: sm.getSessionId() };
}

/** SSE connection under test, canceled after each test to clear timers. */
let activeReader: SseReader | null = null;

beforeEach(() => {
  activeReader = null;
});

afterEach(async () => {
  await activeReader?.cancel();
});

describe("GET /events", () => {
  it("sends internal:init with all sessions and text/event-stream headers", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        const { id } = createSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        const response = await callLoader(container);
        const reader = new SseReader(response);
        activeReader = reader;
        expect(response.headers.get("Content-Type")).toBe("text/event-stream");
        expect(response.headers.get("Cache-Control")).toBe("no-cache");

        const [init] = await reader.read(1);
        expect(init).toEqual({
          kind: "data",
          value: {
            type: "internal:init",
            sessions: [
              expect.objectContaining({
                id,
                cwd,
                firstMessage: "hello",
                messageCount: 2,
                thinkingLevel: expect.any(String),
              }),
            ],
          },
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forwards session events with their info, preserving order", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.create(cwd);
        const sessionId = session.sessionId;

        const response = await callLoader(container);
        const reader = new SseReader(response);
        activeReader = reader;
        await reader.read(1); // internal:init

        session.setThinkingLevel("high");
        // Let the first event's info lookup complete before emitting the
        // second, so each event carries the info at its send time.
        await new Promise((resolve) => setImmediate(resolve));
        session.setThinkingLevel("low");

        const [first, second] = await reader.read(2);
        expect(first).toEqual({
          kind: "data",
          value: {
            type: "internal:event",
            sessionId,
            event: { type: "thinking_level_changed", level: "high" },
            info: expect.objectContaining({ id: sessionId, thinkingLevel: "high" }),
          },
        });
        expect(second).toEqual({
          kind: "data",
          value: {
            type: "internal:event",
            sessionId,
            event: { type: "thinking_level_changed", level: "low" },
            info: expect.objectContaining({ id: sessionId, thinkingLevel: "low" }),
          },
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("buffers events broadcast while the info list loads, delivering them after internal:init", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });

        const container = AgentSessionContainer.withFactory(realFactory);
        let resolveCurrentInfoList!: (sessions: SessionInfo[]) => void;
        vi.spyOn(container, "currentInfoList").mockReturnValue(
          new Promise((resolve) => (resolveCurrentInfoList = resolve)),
        );

        const response = await callLoader(container);
        const reader = new SseReader(response);
        activeReader = reader;

        // Broadcast while the info list is still pending.
        const session = await container.create(cwd);
        const sessionId = session.sessionId;
        session.setThinkingLevel("high");

        resolveCurrentInfoList([]);
        const [init, buffered] = await reader.read(2);
        expect(init).toEqual({
          kind: "data",
          value: { type: "internal:init", sessions: [] },
        });
        expect(buffered).toEqual({
          kind: "data",
          value: {
            type: "internal:event",
            sessionId,
            event: { type: "thinking_level_changed", level: "high" },
            info: expect.objectContaining({ id: sessionId, thinkingLevel: "high" }),
          },
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sends internal:deleted when a session is deleted", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = createSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        // Load the runtime so delete() has something to dispose.
        await container.get(id, { cwd });

        const response = await callLoader(container);
        const reader = new SseReader(response);
        activeReader = reader;
        await reader.read(1); // internal:init

        await container.delete(id, { cwd });

        const [deleted] = await reader.read(1);
        expect(deleted).toEqual({
          kind: "data",
          value: { type: "internal:deleted", sessionId: id },
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes the view/read state in internal:init", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        // Mark the user message displayed so the init carries a cursor.
        await container.get(id, { cwd });
        await container.markMessageDisplayed(id, "user:10");

        const response = await callLoader(container);
        const reader = new SseReader(response);
        activeReader = reader;
        const [init] = await reader.read(1);
        expect(init).toEqual({
          kind: "data",
          value: {
            type: "internal:init",
            sessions: [
              expect.objectContaining({
                id,
                lastDisplayedMessageKey: "user:10",
                latestMessageKey: "assistant:10",
                isRead: false,
              }),
            ],
          },
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forwards mark_displayed as a dedicated internal:view_state event", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        await container.get(id, { cwd });

        const response = await callLoader(container);
        const reader = new SseReader(response);
        activeReader = reader;
        await reader.read(1); // internal:init

        await container.markMessageDisplayed(id, "user:10");
        const [viewState] = await reader.read(1);
        expect(viewState).toEqual({
          kind: "data",
          value: {
            type: "internal:view_state",
            sessionId: id,
            viewState: {
              lastDisplayedMessageKey: "user:10",
              latestMessageKey: "assistant:10",
              isRead: false,
            },
          },
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("delivers a view-state event to every connected client", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        await container.get(id, { cwd });

        const first = new SseReader(await callLoader(container));
        const second = new SseReader(await callLoader(container));
        activeReader = null; // cleaned up manually
        await first.read(1);
        await second.read(1);

        await container.markMessageDisplayed(id, "user:10");
        const [a] = await first.read(1);
        const [b] = await second.read(1);
        expect(a).toEqual(b);
        expect(a).toMatchObject({
          kind: "data",
          value: { type: "internal:view_state", sessionId: id },
        });
        await first.cancel();
        await second.cancel();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps view-state events ordered with agent events", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(id, { cwd });

        const response = await callLoader(container);
        const reader = new SseReader(response);
        activeReader = reader;
        await reader.read(1); // internal:init

        session!.setThinkingLevel("high");
        await container.markMessageDisplayed(id, "user:10");
        await new Promise((resolve) => setImmediate(resolve));
        session!.setThinkingLevel("low");

        const [first, second, third] = await reader.read(3);
        expect(first).toMatchObject({
          kind: "data",
          value: { type: "internal:event" },
        });
        expect(second).toMatchObject({
          kind: "data",
          value: { type: "internal:view_state", sessionId: id },
        });
        expect(third).toMatchObject({
          kind: "data",
          value: { type: "internal:event" },
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sends keep-alive comments every 15s", async () => {
    vi.useFakeTimers();
    try {
      const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
      try {
        await withAgentDir(root, async () => {
          const container = AgentSessionContainer.withFactory(realFactory);
          const response = await callLoader(container);
          const reader = new SseReader(response);
          activeReader = reader;
          await reader.read(1); // internal:init

          vi.advanceTimersByTime(15000);
          const [keepAlive] = await reader.read(1);
          expect(keepAlive).toEqual({ kind: "comment" });
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("unsubscribes and stops the keep-alive timer when the connection is canceled", async () => {
    vi.useFakeTimers();
    try {
      const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-events-"));
      try {
        await withAgentDir(root, async () => {
          const container = AgentSessionContainer.withFactory(realFactory);
          const originalSubscribe = container.subscribe.bind(container);
          let unsubscribed = false;
          vi.spyOn(container, "subscribe").mockImplementation((listener) => {
            const unsubscribe = originalSubscribe(listener);
            return () => {
              unsubscribed = true;
              unsubscribe();
            };
          });

          const response = await callLoader(container);
          const reader = new SseReader(response);
          activeReader = null; // canceled manually below
          await reader.read(1); // internal:init
          expect(vi.getTimerCount()).toBe(1); // keep-alive interval

          await reader.cancel();
          await vi.waitFor(() => expect(unsubscribed).toBe(true));
          expect(vi.getTimerCount()).toBe(0);
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
