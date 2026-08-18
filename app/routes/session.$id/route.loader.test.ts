import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AgentSessionContainer } from "~/agent-session-container";
import { agentSessionContainerContext } from "~/router-contexts";
import { realFactory, withAgentDir } from "~/test-helpers";

import { loader } from "./route";
import { agentSessionContext } from "./router-contexts";

function callLoader(
  container: AgentSessionContainer,
  sessionId: string,
): ReturnType<typeof loader> {
  const context = new RouterContextProvider();
  return container.get(sessionId).then((session) => {
    if (!session) throw new Error(`session ${sessionId} not found`);
    // The production loader reads the session through the route middleware;
    // the test supplies it directly.
    context.set(agentSessionContext, session);
    context.set(agentSessionContainerContext, container);
    return loader({
      request: new Request(`http://localhost/session/${sessionId}`),
      url: new URL(`http://localhost/session/${sessionId}`),
      params: { id: sessionId },
      pattern: "/session/:id",
      context,
    });
  });
}

describe("GET /session/:id loader", () => {
  it("returns an in-flight turn's events as turnEvents", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-route-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.create(cwd);
        // Populate the turn buffer through the container's event handler: no
        // public API starts a turn without running the model, so inject the
        // events the runtime would emit for an in-flight turn.
        const handle = container as unknown as {
          handleSessionEvent(sessionId: string, event: AgentSessionEvent): void;
        };
        handle.handleSessionEvent(session.sessionId, { type: "turn_start" });
        handle.handleSessionEvent(session.sessionId, {
          type: "message_start",
          message: { role: "user", content: "hello", timestamp: Date.now() },
        });

        const data = await callLoader(container, session.sessionId);
        expect(data.messages).toBe(session.messages);
        // The loader forwards the container's buffer reference unchanged, so
        // a client that mounts mid-turn receives the buffered events.
        expect(data.turnEvents).toBe(container.getTurnEvents(session.sessionId));
        expect(data.turnEvents).toEqual([
          { type: "turn_start" },
          expect.objectContaining({ type: "message_start" }),
        ]);
        expect(data.cwd).toBe(cwd);
        expect(data.home).toBe(os.homedir());
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns an empty turn buffer for an idle session", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-route-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.create(cwd);

        const data = await callLoader(container, session.sessionId);
        expect(data.turnEvents).toEqual([]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the shared view state as the restoration anchor", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-route-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        // A persisted session with a known message timeline.
        const sm = SessionManager.create(cwd);
        sm.appendMessage({ role: "user", content: "hello", timestamp: 10 });
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
          timestamp: 10,
        });
        const sessionId = sm.getSessionId();

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(sessionId, { cwd });
        expect(session).not.toBeNull();
        // The loader must hand the client the cursor BEFORE any observer
        // reports a position, so the first render can restore the anchor.
        await container.markMessageDisplayed(sessionId, "user:10");
        const data = await callLoader(container, sessionId);
        expect(data.viewState).toEqual({
          lastDisplayedMessageKey: "user:10",
          latestMessageKey: "assistant:10",
          isRead: false,
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
