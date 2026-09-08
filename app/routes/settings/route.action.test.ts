import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { providerAuthManagerContext } from "~/router-contexts";

import { action } from "./route";

type DataError = {
  type: string;
  data: { error?: string; operationId?: string };
  init?: { status?: number };
};

function contextWith(manager: unknown) {
  const context = new RouterContextProvider();
  context.set(providerAuthManagerContext, manager as never);
  return context;
}

function callAction(
  context: RouterContextProvider,
  body: unknown,
  headers?: Record<string, string>,
) {
  return action({
    request: new Request("http://localhost/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    url: new URL("http://localhost/settings"),
    params: {},
    pattern: "/settings",
    context,
  });
}

function expectDataError(result: unknown, status: number, error: string) {
  const response = result as DataError;
  expect(response.type).toBe("DataWithResponseInit");
  expect(response.init?.status).toBe(status);
  expect(response.data.error).toBe(error);
  return response;
}

describe("POST /settings action", () => {
  it("redirects after starting a login", async () => {
    const manager = {
      startLogin: vi.fn(async () => ({ ok: true as const, operationId: "op-1" })),
      startRemoval: vi.fn(),
    };
    const context = contextWith(manager);
    const response = (await callAction(context, {
      type: "start_login",
      providerId: "a",
      authType: "api_key",
    }).catch((value: unknown) => value)) as Response;
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/settings?authOperation=op-1");
    expect(manager.startLogin).toHaveBeenCalledTimes(1);
    expect(manager.startLogin).toHaveBeenCalledWith("a", "api_key");
    expect(manager.startRemoval).not.toHaveBeenCalled();
  });

  it("starts a removal only after confirmation", async () => {
    const manager = {
      startLogin: vi.fn(),
      startRemoval: vi.fn(async () => ({ ok: true as const, operationId: "op-2" })),
    };
    const context = contextWith(manager);
    const unconfirmed = await callAction(context, {
      type: "start_removal",
      providerId: "a",
      confirmed: false,
    });
    expectDataError(unconfirmed, 400, "Invalid request");
    expect(manager.startRemoval).not.toHaveBeenCalled();
    const response = (await callAction(context, {
      type: "start_removal",
      providerId: "a",
      confirmed: true,
    }).catch((value: unknown) => value)) as Response;
    expect(response.headers.get("Location")).toBe("/settings?authOperation=op-2");
    expect(manager.startRemoval).toHaveBeenCalledTimes(1);
  });

  it("returns the manager's active-operation conflict", async () => {
    const manager = {
      startLogin: vi.fn(async () => ({
        ok: false as const,
        error: "conflict" as const,
        operationId: "active",
      })),
      startRemoval: vi.fn(),
    };
    const context = contextWith(manager);
    const result = await callAction(context, {
      type: "start_login",
      providerId: "b",
      authType: "oauth",
    });
    const response = expectDataError(result, 409, "conflict");
    expect(response.data.operationId).toBe("active");
    expect(manager.startLogin).toHaveBeenCalledTimes(1);
  });

  it("maps unknown providers and unsupported auth to stable codes", async () => {
    const unknownManager = {
      startLogin: vi.fn(async () => ({ ok: false as const, error: "unknown_provider" as const })),
      startRemoval: vi.fn(),
    };
    const unknown = await callAction(contextWith(unknownManager), {
      type: "start_login",
      providerId: "missing",
      authType: "api_key",
    });
    expectDataError(unknown, 404, "unknown_provider");
    const unsupportedManager = {
      startLogin: vi.fn(async () => ({ ok: false as const, error: "unsupported_auth" as const })),
      startRemoval: vi.fn(),
    };
    const unsupported = await callAction(contextWith(unsupportedManager), {
      type: "start_login",
      providerId: "a",
      authType: "oauth",
    });
    expectDataError(unsupported, 400, "unsupported_auth");
    const missingCredential = {
      startLogin: vi.fn(),
      startRemoval: vi.fn(async () => ({
        ok: false as const,
        error: "no_stored_credential" as const,
      })),
    };
    const missing = await callAction(contextWith(missingCredential), {
      type: "start_removal",
      providerId: "a",
      confirmed: true,
    });
    expectDataError(missing, 404, "no_stored_credential");
  });

  it("rejects malformed JSON, invalid discriminators, wrong content types, and cross-origin mutations", async () => {
    const manager = { startLogin: vi.fn(), startRemoval: vi.fn() };
    const invalid = await callAction(contextWith(manager), "not-json{{{", {
      "Content-Type": "application/json",
    });
    expectDataError(invalid, 400, "Invalid request");
    const wrongKind = await callAction(contextWith(manager), { type: "unknown" });
    expectDataError(wrongKind, 400, "Invalid request");
    const wrongContent = await callAction(
      contextWith(manager),
      { type: "start_login", providerId: "a", authType: "api_key" },
      { "Content-Type": "text/plain" },
    );
    expectDataError(wrongContent, 415, "Unsupported media type");
    const crossOrigin = await callAction(
      contextWith(manager),
      { type: "start_login", providerId: "a", authType: "api_key" },
      { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    );
    expectDataError(crossOrigin, 403, "Forbidden");
    expect(manager.startLogin).not.toHaveBeenCalled();
    expect(manager.startRemoval).not.toHaveBeenCalled();
  });
});
