import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AgentSessionContainer } from "~/agent-session-container";
import { agentSessionContainerContext } from "~/router-contexts";
import { oneTurnSession, realFactory, withAgentDir } from "~/test-helpers";

import { action } from "./action";
import { agentSessionContext } from "./router-contexts";

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

describe("POST /session/:id mark_displayed", () => {
  it("advances the shared cursor and returns the resulting read state", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-action-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { id } = oneTurnSession(cwd);

        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.get(id, { cwd });
        expect(session).not.toBeNull();

        const context = new RouterContextProvider();
        context.set(agentSessionContext, session!);
        context.set(agentSessionContainerContext, container);

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
        const session = await container.get(id, { cwd });
        expect(session).not.toBeNull();
        const context = new RouterContextProvider();
        context.set(agentSessionContext, session!);
        context.set(agentSessionContainerContext, container);

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
        const session = await container.get(id, { cwd });
        expect(session).not.toBeNull();
        const context = new RouterContextProvider();
        context.set(agentSessionContext, session!);
        context.set(agentSessionContainerContext, container);

        // Invalid key format: valibot validation fails (schema.validation).
        await expect(
          callAction(context, { type: "mark_displayed", messageKey: "bogus" }),
        ).rejects.toThrow();
        await expect(
          callAction(context, { type: "mark_displayed", messageKey: "" }),
        ).rejects.toThrow();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
