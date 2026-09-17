import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AgentSessionContainer } from "~/agent-session-container";
import { InProcessSessionAdapter } from "~/in-process-session-adapter";
import { sessionActivitySourceContext, sessionExecutorContext } from "~/router-contexts";
import { SdkSessionRepository } from "~/sdk-session-repository";
import type { SessionExecutor } from "~/session-contracts";
import { oneTurnSession, realFactory, withAgentDir } from "~/test-helpers";

import { action } from "./action";
import { sessionIdContext } from "./router-contexts";

function actionContext(sessionId: string, container: AgentSessionContainer) {
  const context = new RouterContextProvider();
  context.set(
    sessionActivitySourceContext,
    new InProcessSessionAdapter(container, new SdkSessionRepository()),
  );
  context.set(sessionIdContext, sessionId);
  return context;
}

function callAction(context: RouterContextProvider, body: unknown): Promise<unknown> {
  return action({
    request: new Request("http://localhost/session/s1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    url: new URL("http://localhost/session/s1"),
    params: { id: "s1" },
    pattern: "/session/:id",
    context,
  });
}

describe("POST /session/:id commands", () => {
  it("delegates execution commands through the session executor", async () => {
    const prompt = vi.fn(async () => undefined);
    const steer = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const executor = { prompt, steer, followUp, abort } as unknown as SessionExecutor;
    const context = new RouterContextProvider();
    context.set(sessionIdContext, "session-1");
    context.set(sessionExecutorContext, executor);
    const input = {
      text: "hello",
      model: { provider: "anthropic", id: "claude" },
      thinkingLevel: "high",
    };

    await callAction(context, { type: "prompt", ...input });
    await callAction(context, { type: "steer", ...input });
    await callAction(context, { type: "follow-up", ...input });
    await callAction(context, { type: "abort" });

    expect(prompt).toHaveBeenCalledWith("session-1", input);
    expect(steer).toHaveBeenCalledWith("session-1", input);
    expect(followUp).toHaveBeenCalledWith("session-1", input);
    expect(abort).toHaveBeenCalledWith("session-1");
  });
});

describe("POST /session/:id mark_displayed", () => {
  it("advances the shared cursor and returns the resulting read state", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-action-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        const context = actionContext(id, container);

        const result = await callAction(context, {
          type: "mark_displayed",
          messageKey: "user:10",
        });
        expect(result).toEqual({
          lastDisplayedMessageKey: "user:10",
          latestMessageKey: "assistant:10",
          isRead: false,
        });

        const result2 = await callAction(context, {
          type: "mark_displayed",
          messageKey: "assistant:10",
        });
        expect(result2).toEqual({
          lastDisplayedMessageKey: "assistant:10",
          latestMessageKey: "assistant:10",
          isRead: true,
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores stale and unknown keys without moving the cursor backwards", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-action-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        const context = actionContext(id, container);

        await container.markMessageDisplayed(id, "assistant:10");
        // A stale report for the older user message must not regress.
        const stale = await callAction(context, {
          type: "mark_displayed",
          messageKey: "user:10",
        });
        expect(stale).toEqual({
          lastDisplayedMessageKey: "assistant:10",
          latestMessageKey: "assistant:10",
          isRead: true,
        });
        // An unknown key is ignored too.
        const unknown = await callAction(context, {
          type: "mark_displayed",
          messageKey: "toolResult:call-42",
        });
        expect(unknown).toMatchObject({ lastDisplayedMessageKey: "assistant:10" });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed message keys", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-action-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        const context = actionContext(id, container);

        // Invalid key format: valibot validation fails (schema.validation).
        await expect(
          callAction(context, { type: "mark_displayed", messageKey: "bogus" }),
        ).rejects.toThrow();
        await expect(
          callAction(context, { type: "mark_displayed", messageKey: "" }),
        ).rejects.toThrow();
        // A trailing suffix must not match the anchored alternation.
        await expect(
          callAction(context, { type: "mark_displayed", messageKey: "user:10x" }),
        ).rejects.toThrow();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
