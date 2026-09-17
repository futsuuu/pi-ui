import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getModel } from "@earendil-works/pi-ai/compat";
import {
  SessionManager,
  type AgentSession,
  type ModelRuntime,
  type PromptOptions,
} from "@earendil-works/pi-coding-agent";
import { RouterContextProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionContainer } from "~/agent-session-container";
import { agentSessionContainerContext, modelRuntimeContext } from "~/router-contexts";
import { withAgentDir } from "~/test-helpers";

import { action, loader } from "./route";

const model = getModel("anthropic", "claude-opus-4-5");

function createHarness(
  runPrompt: (text: string, options?: PromptOptions) => Promise<void> = async (_text, options) => {
    options?.preflightResult?.(true);
  },
) {
  const setModel = vi.fn(async () => undefined);
  const setThinkingLevel = vi.fn();
  const prompt = vi.fn(runPrompt);
  const session = {
    sessionId: "session-1",
    setModel,
    setThinkingLevel,
    prompt,
  } as unknown as AgentSession;
  const create = vi.fn(async () => session);
  const dispose = vi.fn(async () => undefined);
  const container = { create, dispose } as unknown as AgentSessionContainer;
  const getAvailable = vi.fn(async () => [model]);
  const getModelFromRuntime = vi.fn((provider: string, id: string) =>
    provider === model.provider && id === model.id ? model : undefined,
  );
  const modelRuntime = {
    getAvailable,
    getModel: getModelFromRuntime,
  } as unknown as ModelRuntime;
  const context = new RouterContextProvider();
  context.set(agentSessionContainerContext, container);
  context.set(modelRuntimeContext, modelRuntime);
  return {
    context,
    create,
    dispose,
    getModelFromRuntime,
    prompt,
    setModel,
    setThinkingLevel,
  };
}

function callLoader(context: RouterContextProvider, dir: string) {
  const url = new URL(`http://localhost/session/new?dir=${encodeURIComponent(dir)}`);
  return loader({
    request: new Request(url),
    url,
    params: {},
    pattern: "/session/new",
    context,
  });
}

function callAction(context: RouterContextProvider, dir: string) {
  const url = new URL(`http://localhost/session/new?dir=${encodeURIComponent(dir)}`);
  return action({
    request: new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "hello",
        model: { provider: model.provider, id: model.id },
        thinkingLevel: "high",
      }),
    }),
    url,
    params: {},
    pattern: "/session/new",
    context,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("/session/new", () => {
  it("creates no session on GET and accepts the first prompt after fifteen minutes", async () => {
    vi.useFakeTimers();
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-new-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { context, create, dispose, prompt, setModel, setThinkingLevel } = createHarness(
          async (_text, options) => {
            options?.preflightResult?.(true);
            await new Promise(() => undefined);
          },
        );

        const data = await callLoader(context, cwd);
        expect(data.dir).toBe(cwd);
        expect(create).not.toHaveBeenCalled();
        expect(await SessionManager.list(cwd)).toEqual([]);

        await vi.advanceTimersByTimeAsync(16 * 60 * 1000);

        const response = await callAction(context, cwd);
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe("/session/session-1");
        expect(create).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledWith(cwd);
        expect(setModel).toHaveBeenCalledWith(model);
        expect(setThinkingLevel).toHaveBeenCalledWith("high");
        expect(prompt).toHaveBeenCalledWith(
          "hello",
          expect.objectContaining({ preflightResult: expect.any(Function) }),
        );
        expect(dispose).not.toHaveBeenCalled();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("disposes the new runtime when prompt startup fails", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-new-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const failure = new Error("authentication failed");
        const { context, dispose } = createHarness(async () => {
          throw failure;
        });

        await expect(callAction(context, cwd)).rejects.toBe(failure);
        expect(dispose).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledWith("session-1");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("disposes the new runtime when the selected model no longer exists", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-new-session-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const { context, dispose, getModelFromRuntime, prompt } = createHarness();
        getModelFromRuntime.mockReturnValue(undefined);

        await expect(callAction(context, cwd)).rejects.toThrow("not found");
        expect(prompt).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledWith("session-1");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
