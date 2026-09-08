import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { ProviderStatusDto } from "~/provider-auth-manager";
import { providerAuthManagerContext } from "~/router-contexts";

import { loader } from "./route";

const providers: ProviderStatusDto[] = [
  {
    registration: "registered",
    id: "a",
    name: "A",
    methods: [{ type: "api_key", label: "A key" }],
    storedCredential: null,
    effectiveAuth: null,
  },
];

function contextWith(
  listImpl: () => Promise<ProviderStatusDto[]>,
  snapshotImpl: (id: string) => unknown,
) {
  const manager = {
    listProviders: vi.fn(listImpl),
    getSnapshot: vi.fn(snapshotImpl),
  };
  const context = new RouterContextProvider();
  context.set(providerAuthManagerContext, manager as never);
  return { context, manager };
}

function callLoader(context: RouterContextProvider, url: string) {
  return loader({
    request: new Request(url),
    url: new URL(url),
    params: {},
    pattern: "/settings",
    context,
  });
}

describe("GET /settings loader", () => {
  it("returns provider status without an operation snapshot", async () => {
    const { context, manager } = contextWith(
      async () => providers,
      () => undefined,
    );
    const result = await callLoader(context, "http://localhost/settings");
    expect(result).toEqual({ providers, operation: null });
    expect(manager.listProviders).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot).not.toHaveBeenCalled();
  });

  it("includes the operation snapshot for a valid authOperation parameter", async () => {
    const snapshot = { operationId: "op-1", kind: "login" };
    const { context, manager } = contextWith(
      async () => providers,
      (id: string) => (id === "op-1" ? snapshot : undefined),
    );
    const result = await callLoader(context, "http://localhost/settings?authOperation=op-1");
    expect(result).toEqual({ providers, operation: snapshot });
    expect(manager.getSnapshot).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot).toHaveBeenCalledWith("op-1");
  });

  it("removes an expired operation parameter with a replace redirect", async () => {
    const { context } = contextWith(
      async () => providers,
      () => undefined,
    );
    const error = (await callLoader(context, "http://localhost/settings?authOperation=stale").catch(
      (value: unknown) => value,
    )) as Response;
    expect(error).toBeInstanceOf(Response);
    expect(error.status).toBe(302);
    expect(error.headers.get("Location")).toBe("/settings");
  });
});
