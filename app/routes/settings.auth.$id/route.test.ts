import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { providerAuthManagerContext } from "~/router-contexts";

import { action, loader } from "./route";

type DataError = {
  type: string;
  data: { error?: string };
  init?: { status?: number };
};

function contextWith(manager: unknown) {
  const context = new RouterContextProvider();
  context.set(providerAuthManagerContext, manager as never);
  return context;
}

function callLoader(context: RouterContextProvider, id: string) {
  return loader({
    request: new Request(`http://localhost/settings/auth/${id}`),
    url: new URL(`http://localhost/settings/auth/${id}`),
    params: { id },
    pattern: "/settings/auth/:id",
    context,
  });
}

function callAction(
  context: RouterContextProvider,
  id: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  return action({
    request: new Request(`http://localhost/settings/auth/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    url: new URL(`http://localhost/settings/auth/${id}`),
    params: { id },
    pattern: "/settings/auth/:id",
    context,
  });
}

function expectDataError(result: unknown, status: number, error: string) {
  const response = result as DataError;
  expect(response.type).toBe("DataWithResponseInit");
  expect(response.init?.status).toBe(status);
  expect(response.data.error).toBe(error);
}

describe("GET /settings/auth/:id loader", () => {
  it("returns the current snapshot for a valid operation", async () => {
    const snapshot = { operationId: "op-1", phase: "running" };
    const manager = { getSnapshot: vi.fn(() => snapshot) };
    const result = await callLoader(contextWith(manager), "op-1");
    expect(result).toEqual({ operation: snapshot });
    expect(manager.getSnapshot).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot).toHaveBeenCalledWith("op-1");
  });

  it("returns not_found for unknown operations", async () => {
    const manager = { getSnapshot: vi.fn(() => undefined) };
    const result = await callLoader(contextWith(manager), "missing");
    expectDataError(result, 404, "not_found");
  });
});

describe("POST /settings/auth/:id action", () => {
  it("forwards a prompt answer", async () => {
    const manager = { answerPrompt: vi.fn(() => ({ ok: true })), cancelLogin: vi.fn() };
    const context = contextWith(manager);
    const result = await callAction(context, "op-1", {
      type: "answer",
      promptId: 2,
      answer: "secret",
    });
    expect(result).toEqual({ ok: true });
    expect(manager.answerPrompt).toHaveBeenCalledTimes(1);
    expect(manager.answerPrompt).toHaveBeenCalledWith("op-1", 2, "secret");
    expect(manager.cancelLogin).not.toHaveBeenCalled();
  });

  it("cancels an active login", async () => {
    const manager = { answerPrompt: vi.fn(), cancelLogin: vi.fn(() => ({ ok: true })) };
    const result = await callAction(contextWith(manager), "op-1", { type: "cancel" });
    expect(result).toEqual({ ok: true });
    expect(manager.cancelLogin).toHaveBeenCalledTimes(1);
    expect(manager.cancelLogin).toHaveBeenCalledWith("op-1");
  });

  it("maps stale prompts and invalid states to stable codes", async () => {
    const stale = {
      answerPrompt: vi.fn(() => ({ ok: false, error: "stale_prompt" })),
      cancelLogin: vi.fn(),
    };
    const staleResult = await callAction(contextWith(stale), "op-1", {
      type: "answer",
      promptId: 1,
      answer: "x",
    });
    expectDataError(staleResult, 409, "stale_prompt");
    const invalid = {
      answerPrompt: vi.fn(() => ({ ok: false, error: "invalid_state" })),
      cancelLogin: vi.fn(),
    };
    const invalidResult = await callAction(contextWith(invalid), "op-1", {
      type: "answer",
      promptId: 1,
      answer: "x",
    });
    expectDataError(invalidResult, 409, "invalid_state");
    const incompatible = {
      answerPrompt: vi.fn(() => ({ ok: false, error: "incompatible_kind" })),
      cancelLogin: vi.fn(),
    };
    const incompatibleResult = await callAction(contextWith(incompatible), "op-1", {
      type: "answer",
      promptId: 1,
      answer: "x",
    });
    expectDataError(incompatibleResult, 400, "incompatible_kind");
    const missing = {
      answerPrompt: vi.fn(() => ({ ok: false, error: "not_found" })),
      cancelLogin: vi.fn(),
    };
    const missingResult = await callAction(contextWith(missing), "missing", {
      type: "answer",
      promptId: 1,
      answer: "x",
    });
    expectDataError(missingResult, 404, "not_found");
  });

  it("rejects removal cancellation as an incompatible kind", async () => {
    const manager = {
      answerPrompt: vi.fn(),
      cancelLogin: vi.fn(() => ({ ok: false, error: "incompatible_kind" })),
    };
    const result = await callAction(contextWith(manager), "op-1", { type: "cancel" });
    expectDataError(result, 400, "incompatible_kind");
  });

  it("rejects malformed payloads, wrong content types, and cross-origin posts", async () => {
    const manager = { answerPrompt: vi.fn(), cancelLogin: vi.fn() };
    const malformed = await callAction(contextWith(manager), "op-1", "bad{{{");
    expectDataError(malformed, 400, "Invalid request");
    const invalid = await callAction(contextWith(manager), "op-1", { type: "nope" });
    expectDataError(invalid, 400, "Invalid request");
    const wrongContent = await callAction(
      contextWith(manager),
      "op-1",
      { type: "cancel" },
      {
        "Content-Type": "text/plain",
      },
    );
    expectDataError(wrongContent, 415, "Unsupported media type");
    const crossOrigin = await callAction(
      contextWith(manager),
      "op-1",
      { type: "cancel" },
      {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    );
    expectDataError(crossOrigin, 403, "Forbidden");
    expect(manager.answerPrompt).not.toHaveBeenCalled();
    expect(manager.cancelLogin).not.toHaveBeenCalled();
  });
});
