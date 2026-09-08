import { createProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import type {
  AuthEvent,
  AuthPrompt,
  CredentialInfo,
  OAuthCredential,
  Provider,
  ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import { CredentialSynchronizationError, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  ProviderAuthManager,
  type ProviderStatusDto,
  type RuntimePort,
} from "./provider-auth-manager";

function stubApi() {
  const notImplemented = () => {
    throw new Error("not implemented");
  };
  return { stream: notImplemented, streamSimple: notImplemented };
}

function testProvider(options: {
  id: string;
  name?: string;
  apiKeyLogin?: Provider["auth"]["apiKey"];
  oauth?: Provider["auth"]["oauth"];
}): Provider {
  return {
    id: options.id,
    name: options.name ?? options.id,
    auth: {
      ...(options.apiKeyLogin ? { apiKey: options.apiKeyLogin } : {}),
      ...(options.oauth ? { oauth: options.oauth } : {}),
    },
    getModels: () => [],
    stream: stubApi().stream as Provider["stream"],
    streamSimple: stubApi().streamSimple as Provider["streamSimple"],
  } as unknown as Provider;
}

function fakeRuntime(options: {
  providers?: Provider[];
  stored?: CredentialInfo[];
  configured?: Set<string>;
  oauth?: Set<string>;
  status?: Map<
    string,
    {
      source?:
        | "stored"
        | "runtime"
        | "environment"
        | "fallback"
        | "models_json_key"
        | "models_json_command";
      label?: string;
    }
  >;
  login?: RuntimePort["login"];
  logout?: RuntimePort["logout"];
  refresh?: RuntimePort["refresh"];
  getAuthSpy?: () => never;
}): RuntimePort & { getAuth: () => never } {
  const providers = options.providers ?? [];
  const stored = options.stored ?? [];
  const configured = options.configured ?? new Set<string>();
  const oauth = options.oauth ?? new Set<string>();
  const status = options.status ?? new Map();
  return {
    getProviders: () => providers,
    listCredentials: async () => stored,
    hasConfiguredAuth: (id: string) => configured.has(id),
    isUsingOAuth: (id: string) => oauth.has(id),
    getProviderAuthStatus: (id: string) => {
      const entry = status.get(id);
      if (entry?.source) return { configured: true, source: entry.source, label: entry.label };
      return configured.has(id)
        ? { configured: true, source: "environment" as const, label: "TEST_ENV" }
        : { configured: false };
    },
    login:
      options.login ??
      (async () => {
        throw new Error("login not implemented");
      }),
    logout:
      options.logout ??
      (async () => {
        throw new Error("logout not implemented");
      }),
    refresh: options.refresh ?? (async () => ({ aborted: false, errors: new Map() })),
    getAuth:
      options.getAuthSpy ??
      (() => {
        throw new Error("getAuth must not be called");
      }),
  } as unknown as RuntimePort & { getAuth: () => never };
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("provider projection", () => {
  it("derives the union of runtime providers and stored metadata", async () => {
    const providers = [
      testProvider({
        id: "a",
        name: "Provider A",
        apiKeyLogin: {
          name: "A key",
          login: async () => ({ type: "api_key" as const }),
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      stored: [
        { providerId: "a", type: "api_key" },
        { providerId: "ghost", type: "oauth" },
      ],
      configured: new Set(["a"]),
    });
    const manager = new ProviderAuthManager(runtime);
    const list = await manager.listProviders();
    expect(list.map((entry) => entry.id).sort()).toEqual(["a", "ghost"]);
    const ghost = list.find((entry) => entry.id === "ghost")!;
    expect(ghost.registration).toBe("orphaned");
    expect(ghost.effectiveAuth).toBeNull();
    if (ghost.registration === "orphaned") {
      expect(ghost.storedCredential).toEqual({ type: "oauth" });
    }
  });

  it("never calls getAuth while listing", async () => {
    const spy = vi.fn(() => {
      throw new Error("getAuth must not be called");
    });
    const providers = [
      testProvider({
        id: "a",
        apiKeyLogin: {
          name: "A key",
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({ providers, getAuthSpy: spy });
    const manager = new ProviderAuthManager(runtime);
    await manager.listProviders();
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports stored and effective authentication separately", async () => {
    const providers = [
      testProvider({
        id: "a",
        name: "A",
        apiKeyLogin: {
          name: "A key",
          login: async () => ({ type: "api_key" as const }),
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      stored: [{ providerId: "a", type: "oauth" }],
      configured: new Set(),
      status: new Map(),
    });
    const manager = new ProviderAuthManager(runtime);
    const list = await manager.listProviders();
    const entry = list.find((item) => item.id === "a")!;
    expect(entry.registration).toBe("registered");
    if (entry.registration === "registered") {
      expect(entry.storedCredential).toEqual({ type: "oauth" });
      expect(entry.effectiveAuth).toBeNull();
    }
  });

  it("selects api-key and oauth methods with provider labels", async () => {
    const providers = [
      testProvider({
        id: "both",
        name: "Both",
        apiKeyLogin: {
          name: "Both key",
          login: async () => ({ type: "api_key" as const }),
        } as unknown as Provider["auth"]["apiKey"],
        oauth: {
          name: "Both OAuth",
          loginLabel: "Sign in with Both",
          login: async () => ({ type: "oauth" as const, refresh: "r", access: "a", expires: 1 }),
          refresh: async (credential: OAuthCredential) => credential,
          toAuth: async () => ({}),
        } as unknown as Provider["auth"]["oauth"],
      }),
      testProvider({
        id: "ambient",
        name: "Ambient",
        apiKeyLogin: {
          name: "Ambient",
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({ providers });
    const manager = new ProviderAuthManager(runtime);
    const list = await manager.listProviders();
    const both = list.find((entry) => entry.id === "both")!;
    if (both.registration !== "registered") throw new Error("expected registered");
    expect(both.methods).toEqual([
      { type: "api_key", label: "Both key" },
      { type: "oauth", label: "Sign in with Both" },
    ]);
    const ambient = list.find((entry) => entry.id === "ambient")!;
    if (ambient.registration !== "registered") throw new Error("expected registered");
    expect(ambient.methods).toEqual([]);
  });

  it("uses getProviderAuthStatus only for source kind and label", async () => {
    const providers = [
      testProvider({
        id: "a",
        apiKeyLogin: {
          name: "A",
          login: async () => ({ type: "api_key" as const }),
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      stored: [{ providerId: "a", type: "api_key" }],
      configured: new Set(["a"]),
      oauth: new Set(),
      status: new Map([["a", { source: "runtime" }]]),
    });
    const manager = new ProviderAuthManager(runtime);
    const list = await manager.listProviders();
    const entry = list.find((item) => item.id === "a")!;
    if (entry.registration !== "registered") throw new Error("expected registered");
    expect(entry.effectiveAuth).toEqual({ type: "api_key", source: { kind: "runtime" } });
  });
});

describe("login operation", () => {
  it("delivers each answer to its intended prompt", async () => {
    const seen: string[] = [];
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: async (interaction: ProviderAuthInteraction) => {
            interaction.notify({ type: "progress", message: "starting" });
            const first = await interaction.prompt({ type: "text", message: "first" });
            seen.push(first);
            interaction.notify({ type: "info", message: "got first" });
            const second = await interaction.prompt({ type: "secret", message: "second" });
            seen.push(second);
            return { type: "api_key", key: "k" };
          },
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      login: async (providerId, _type, interaction) => {
        const provider = providers[0];
        return provider.auth.apiKey!.login!({
          ...interaction,
          signal: interaction.signal ?? new AbortController().signal,
        });
      },
    });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 50,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" &&
          snapshot.phase === "running" &&
          snapshot.prompt?.message === "first"
        );
      });
      const first = manager.getSnapshot(started.operationId);
      if (first?.kind !== "login" || first.phase !== "running" || !first.prompt)
        throw new Error("missing first prompt");
      expect(manager.answerPrompt(started.operationId, first.prompt.id, "one")).toEqual({
        ok: true,
      });
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" &&
          snapshot.phase === "running" &&
          snapshot.prompt?.message === "second"
        );
      });
      const second = manager.getSnapshot(started.operationId);
      if (second?.kind !== "login" || second.phase !== "running" || !second.prompt)
        throw new Error("missing second prompt");
      expect(manager.answerPrompt(started.operationId, second.prompt.id, "two")).toEqual({
        ok: true,
      });
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      expect(seen).toEqual(["one", "two"]);
      const terminal = manager.getSnapshot(started.operationId);
      expect(terminal?.phase).toBe("terminal");
      if (terminal?.phase === "terminal") {
        expect(terminal.outcome).toBe("success");
      }
    } finally {
      manager.dispose();
    }
  });

  it("rejects stale, duplicate, and post-terminal answers", async () => {
    let resolveFirst!: (value: string) => void;
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: (interaction: ProviderAuthInteraction) =>
            new Promise((resolve) => {
              resolveFirst = resolve as (value: string) => void;
              void interaction.prompt({ type: "text", message: "first" }).then(
                (answer: string) =>
                  interaction
                    .prompt({ type: "text", message: "second" })
                    .then(() => resolve({ type: "api_key" as const, key: answer })),
                () => resolve({ type: "api_key" as const }),
              );
            }),
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      login: async (_id, _type, interaction) =>
        providers[0].auth.apiKey!.login!({
          ...interaction,
          signal: interaction.signal ?? new AbortController().signal,
        }),
    });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 50,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(
        () =>
          manager.getSnapshot(started.operationId)?.phase === "running" &&
          manager.getSnapshot(started.operationId)?.phase === "running",
      );
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" && snapshot.phase === "running" && snapshot.prompt !== null
        );
      });
      const running = manager.getSnapshot(started.operationId);
      if (running?.kind !== "login" || running.phase !== "running" || !running.prompt)
        throw new Error("missing prompt");
      const promptId = running.prompt.id;
      expect(manager.answerPrompt(started.operationId, promptId, "a")).toEqual({ ok: true });
      expect(manager.answerPrompt(started.operationId, promptId, "duplicate")).toEqual({
        ok: false,
        error: "stale_prompt",
      });
      expect(manager.answerPrompt("missing", promptId, "x")).toEqual({
        ok: false,
        error: "not_found",
      });
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" &&
          snapshot.phase === "running" &&
          snapshot.prompt?.message === "second"
        );
      });
      expect(manager.answerPrompt(started.operationId, promptId, "stale")).toEqual({
        ok: false,
        error: "stale_prompt",
      });
      const second = manager.getSnapshot(started.operationId);
      if (second?.kind !== "login" || second.phase !== "running" || !second.prompt)
        throw new Error("missing second");
      expect(manager.answerPrompt(started.operationId, second.prompt.id, "b")).toEqual({
        ok: true,
      });
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      expect(manager.answerPrompt(started.operationId, second.prompt.id, "late")).toEqual({
        ok: false,
        error: "invalid_state",
      });
      expect(resolveFirst).toBeDefined();
    } finally {
      manager.dispose();
    }
  });

  it("does not publish a pre-aborted prompt and continues the flow", async () => {
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: async (interaction: ProviderAuthInteraction) => {
            const promptController = new AbortController();
            promptController.abort(new Error("race won by callback"));
            await expect(
              interaction.prompt({
                type: "text",
                message: "skipped",
                signal: promptController.signal,
              }),
            ).rejects.toThrow();
            const answer = await interaction.prompt({ type: "text", message: "next" });
            return { type: "api_key", key: answer };
          },
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      login: async (_id, _type, interaction) =>
        providers[0].auth.apiKey!.login!({
          ...interaction,
          signal: interaction.signal ?? new AbortController().signal,
        }),
    });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 50,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" &&
          snapshot.phase === "running" &&
          snapshot.prompt?.message === "next"
        );
      });
      const snapshot = manager.getSnapshot(started.operationId);
      if (snapshot?.kind !== "login" || snapshot.phase !== "running" || !snapshot.prompt)
        throw new Error("missing prompt");
      expect(snapshot.prompt.message).toBe("next");
      manager.answerPrompt(started.operationId, snapshot.prompt.id, "value");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      expect(manager.getSnapshot(started.operationId)?.phase).toBe("terminal");
    } finally {
      manager.dispose();
    }
  });

  it("aborting a pending prompt keeps the login running", async () => {
    let promptController!: AbortController;
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: async (interaction: ProviderAuthInteraction) => {
            promptController = new AbortController();
            const first = interaction.prompt({
              type: "text",
              message: "first",
              signal: promptController.signal,
            });
            await new Promise((resolve) => setTimeout(resolve, 5));
            promptController.abort(new Error("callback won"));
            await expect(first).rejects.toThrow();
            const answer = await interaction.prompt({ type: "text", message: "second" });
            return { type: "api_key", key: answer };
          },
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      login: async (_id, _type, interaction) =>
        providers[0].auth.apiKey!.login!({
          ...interaction,
          signal: interaction.signal ?? new AbortController().signal,
        }),
    });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 50,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" &&
          snapshot.phase === "running" &&
          snapshot.prompt?.message === "second"
        );
      });
      expect(promptController.signal.aborted).toBe(true);
      const snapshot = manager.getSnapshot(started.operationId);
      if (snapshot?.kind !== "login" || snapshot.phase !== "running" || !snapshot.prompt)
        throw new Error("missing second");
      manager.answerPrompt(started.operationId, snapshot.prompt.id, "ok");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
    } finally {
      manager.dispose();
    }
  });

  it("serializes every prompt and event variant without secrets", async () => {
    const prompts: AuthPrompt[] = [
      { type: "text", message: "t", placeholder: "ph" },
      { type: "secret", message: "s" },
      {
        type: "select",
        message: "c",
        options: [{ id: "a", label: "A", description: "desc" }],
      },
      { type: "manual_code", message: "m" },
    ];
    const events: AuthEvent[] = [
      { type: "info", message: "hello", links: [{ url: "https://example.com", label: "docs" }] },
      { type: "auth_url", url: "https://example.com/auth", instructions: "open" },
      {
        type: "device_code",
        userCode: "ABCD-1234",
        verificationUri: "https://example.com/device",
        intervalSeconds: 5,
        expiresInSeconds: 300,
      },
      { type: "progress", message: "working" },
    ];
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: async (interaction: ProviderAuthInteraction) => {
            for (const event of events) interaction.notify(event);
            let last = "";
            for (const prompt of prompts) {
              last = await interaction.prompt(prompt);
            }
            return { type: "api_key", key: last };
          },
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      login: async (_id, _type, interaction) =>
        providers[0].auth.apiKey!.login!({
          ...interaction,
          signal: interaction.signal ?? new AbortController().signal,
        }),
    });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 50,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" &&
          snapshot.phase === "running" &&
          snapshot.events.length === events.length
        );
      });
      const snapshot = manager.getSnapshot(started.operationId);
      if (snapshot?.kind !== "login" || snapshot.phase !== "running")
        throw new Error("expected running");
      expect(snapshot.events).toEqual(events);
      for (let index = 0; index < prompts.length; index++) {
        await waitFor(() => {
          const current = manager.getSnapshot(started.operationId);
          return (
            current?.kind === "login" &&
            current.phase === "running" &&
            current.prompt?.type === prompts[index].type
          );
        });
        const current = manager.getSnapshot(started.operationId);
        if (current?.kind !== "login" || current.phase !== "running" || !current.prompt)
          throw new Error("missing prompt");
        expect(current.prompt.type).toBe(prompts[index].type);
        manager.answerPrompt(started.operationId, current.prompt.id, `secret-${index}`);
      }
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      const terminal = manager.getSnapshot(started.operationId);
      const serialized = JSON.stringify(terminal);
      expect(serialized).not.toContain("secret-0");
      expect(serialized).not.toContain("secret-1");
    } finally {
      manager.dispose();
    }
  });

  it("keeps only one active operation across providers and kinds", async () => {
    const providers = [
      testProvider({
        id: "a",
        name: "A",
        apiKeyLogin: {
          name: "A key",
          login: () => new Promise(() => {}),
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
      testProvider({
        id: "b",
        name: "B",
        apiKeyLogin: {
          name: "B key",
          login: () => new Promise(() => {}),
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      stored: [{ providerId: "b", type: "api_key" }],
      login: () => new Promise(() => {}),
      logout: () => new Promise(() => {}),
    });
    const manager = new ProviderAuthManager(runtime);
    try {
      const first = await manager.startLogin("a", "api_key");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = await manager.startLogin("b", "api_key");
      expect(second).toEqual({ ok: false, error: "conflict", operationId: first.operationId });
      const removal = await manager.startRemoval("b");
      expect(removal).toEqual({ ok: false, error: "conflict", operationId: first.operationId });
      expect(manager.cancelLogin("missing")).toEqual({ ok: false, error: "not_found" });
    } finally {
      manager.dispose();
    }
  });

  it("cancels a login and stops further answers", async () => {
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: (interaction: ProviderAuthInteraction) =>
            interaction
              .prompt({ type: "text", message: "code" })
              .then((code: string) => ({ type: "api_key" as const, key: code })),
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    let loginRejected = false;
    const runtime = fakeRuntime({
      providers,
      login: async (_id, _type, interaction) => {
        try {
          return await providers[0].auth.apiKey!.login!({
            ...interaction,
            signal: interaction.signal ?? new AbortController().signal,
          });
        } catch {
          loginRejected = true;
          throw new Error("aborted");
        }
      },
    });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 100,
      catalogRefreshTimeoutMs: 50,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" && snapshot.phase === "running" && snapshot.prompt !== null
        );
      });
      expect(manager.cancelLogin(started.operationId)).toEqual({ ok: true });
      const terminal = manager.getSnapshot(started.operationId);
      expect(terminal?.phase).toBe("terminal");
      if (terminal?.phase === "terminal") {
        expect(terminal.outcome).toBe("cancelled");
      }
      expect(manager.answerPrompt(started.operationId, 1, "late")).toEqual({
        ok: false,
        error: "invalid_state",
      });
      await waitFor(() => loginRejected);
    } finally {
      manager.dispose();
    }
  });

  it("times out an idle login", async () => {
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: () => new Promise(() => {}),
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({ providers, login: () => new Promise(() => {}) });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 20,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 50,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return snapshot?.phase === "terminal";
      });
      expect(manager.getSnapshot(started.operationId)?.phase).toBe("terminal");
      const terminal = manager.getSnapshot(started.operationId);
      if (terminal?.phase === "terminal") {
        expect(terminal.outcome).toBe("timeout");
      }
    } finally {
      manager.dispose();
    }
  });

  it("maps login synchronization failures to warnings", async () => {
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: async () => ({ type: "api_key", key: "k" }),
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      login: async () => {
        throw new CredentialSynchronizationError("p", "login", { type: "api_key", key: "k" }, {});
      },
    });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 50,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      const terminal = manager.getSnapshot(started.operationId);
      if (terminal?.phase !== "terminal") throw new Error("expected terminal");
      expect(terminal.outcome).toBe("warning");
    } finally {
      manager.dispose();
    }
  });

  it("runs one bounded forced provider-scoped refresh after login", async () => {
    const refreshCalls: { providers?: readonly string[]; force?: boolean }[] = [];
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: async () => ({ type: "api_key", key: "k" }),
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      login: async () => ({ type: "api_key", key: "k" }),
      refresh: async (options) => {
        refreshCalls.push({ providers: options?.providers, force: options?.force });
        return { aborted: false, errors: new Map() };
      },
    });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 200,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      expect(refreshCalls).toHaveLength(1);
      expect(refreshCalls[0].providers).toEqual(["p"]);
      expect(refreshCalls[0].force).toBe(true);
    } finally {
      manager.dispose();
    }
  });

  it("turns catalog refresh failures into warnings", async () => {
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: async () => ({ type: "api_key", key: "k" }),
          resolve: async () => undefined,
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      login: async () => ({ type: "api_key", key: "k" }),
      refresh: async () => ({ aborted: false, errors: new Map([["p", new Error("network")]]) }),
    });
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 200,
    });
    try {
      const started = await manager.startLogin("p", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      const terminal = manager.getSnapshot(started.operationId);
      if (terminal?.phase !== "terminal") throw new Error("expected terminal");
      expect(terminal.outcome).toBe("warning");
    } finally {
      manager.dispose();
    }
  });
});

describe("removal operation", () => {
  it("starts removal only for stored credentials and exposes no cancellation", async () => {
    const loggedOut: string[] = [];
    let releaseLogout!: () => void;
    const logoutGate = new Promise<void>((resolve) => {
      releaseLogout = resolve;
    });
    const providers = [
      testProvider({
        id: "p",
        name: "P",
        apiKeyLogin: {
          name: "P key",
          login: async () => ({ type: "api_key" as const }),
        } as unknown as Provider["auth"]["apiKey"],
      }),
    ];
    const runtime = fakeRuntime({
      providers,
      stored: [{ providerId: "p", type: "api_key" }],
      logout: async (providerId) => {
        loggedOut.push(providerId);
        await logoutGate;
      },
    });
    const manager = new ProviderAuthManager(runtime, { terminalTtlMs: 50 });
    try {
      const missing = await manager.startRemoval("unknown");
      expect(missing).toEqual({ ok: false, error: "no_stored_credential" });
      const started = await manager.startRemoval("p");
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      expect(manager.getSnapshot(started.operationId)?.phase).toBe("running");
      expect(manager.cancelLogin(started.operationId)).toEqual({
        ok: false,
        error: "incompatible_kind",
      });
      expect(manager.answerPrompt(started.operationId, 1, "x")).toEqual({
        ok: false,
        error: "incompatible_kind",
      });
      releaseLogout();
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      expect(loggedOut).toEqual(["p"]);
      const terminal = manager.getSnapshot(started.operationId);
      if (terminal?.phase !== "terminal") throw new Error("expected terminal");
      expect(terminal.outcome).toBe("success");
    } finally {
      manager.dispose();
    }
  });

  it("times out a stalled removal and releases the operation slot", async () => {
    let aborted = false;
    const providers = [testProvider({ id: "p", name: "P" })];
    const runtime = fakeRuntime({
      providers,
      stored: [{ providerId: "p", type: "api_key" }],
      logout: async (_providerId, options) =>
        new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(options.signal?.reason);
            },
            { once: true },
          );
        }),
    });
    const manager = new ProviderAuthManager(runtime, {
      removalTimeoutMs: 20,
      terminalTtlMs: 50,
    });
    try {
      const started = await manager.startRemoval("p");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      expect(aborted).toBe(true);
      const terminal = manager.getSnapshot(started.operationId);
      if (terminal?.phase !== "terminal") throw new Error("expected terminal");
      expect(terminal.outcome).toBe("failure");
      expect(terminal.message).toBe("Removal timed out.");
      const replacement = await manager.startRemoval("p");
      expect(replacement.ok).toBe(true);
    } finally {
      manager.dispose();
    }
  });

  it("performs no catalog refresh after removal", async () => {
    const refresh = vi.fn(async () => ({ aborted: false, errors: new Map() }));
    const providers = [testProvider({ id: "p", name: "P" })];
    const runtime = fakeRuntime({
      providers,
      stored: [{ providerId: "p", type: "api_key" }],
      logout: async () => {},
      refresh,
    });
    const manager = new ProviderAuthManager(runtime, { terminalTtlMs: 50 });
    try {
      const started = await manager.startRemoval("p");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      manager.dispose();
    }
  });

  it("maps logout synchronization failures to warnings", async () => {
    const providers = [testProvider({ id: "p", name: "P" })];
    const runtime = fakeRuntime({
      providers,
      stored: [{ providerId: "p", type: "api_key" }],
      logout: async () => {
        throw new CredentialSynchronizationError("p", "logout", undefined, {});
      },
    });
    const manager = new ProviderAuthManager(runtime, { terminalTtlMs: 50 });
    try {
      const started = await manager.startRemoval("p");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      const terminal = manager.getSnapshot(started.operationId);
      if (terminal?.phase !== "terminal") throw new Error("expected terminal");
      expect(terminal.outcome).toBe("warning");
    } finally {
      manager.dispose();
    }
  });
});

describe("real ModelRuntime integration", () => {
  async function createRuntime() {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    return runtime;
  }

  function apiKeyProvider(id: string) {
    return createProvider({
      id,
      name: `Test ${id}`,
      auth: {
        apiKey: {
          name: `Test ${id} key`,
          login: async (interaction: ProviderAuthInteraction) => {
            const key = await interaction.prompt({ type: "secret", message: "Enter key" });
            return { type: "api_key" as const, key };
          },
          resolve: async ({ credential }) =>
            credential?.type === "api_key" && credential.key
              ? { auth: { apiKey: credential.key }, source: "stored" }
              : undefined,
        },
      },
      models: [],
      api: stubApi(),
    });
  }

  it("lists stored and effective auth from the shared runtime", async () => {
    const runtime = await createRuntime();
    runtime.registerNativeProvider(apiKeyProvider("test-int"));
    const manager = new ProviderAuthManager(runtime, {
      loginIdleTimeoutMs: 1000,
      terminalTtlMs: 50,
      catalogRefreshTimeoutMs: 200,
    });
    try {
      const before = await manager.listProviders();
      const entry = before.find((item) => item.id === "test-int")!;
      expect(entry.registration).toBe("registered");
      if (entry.registration === "registered") {
        expect(entry.storedCredential).toBeNull();
        expect(entry.effectiveAuth).toBeNull();
      }
      const started = await manager.startLogin("test-int", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" && snapshot.phase === "running" && snapshot.prompt !== null
        );
      });
      const snapshot = manager.getSnapshot(started.operationId);
      if (snapshot?.kind !== "login" || snapshot.phase !== "running" || !snapshot.prompt)
        throw new Error("missing prompt");
      manager.answerPrompt(started.operationId, snapshot.prompt.id, "key-123");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      const stored = await runtime.listCredentials();
      expect(stored.some((item) => item.providerId === "test-int")).toBe(true);
      expect(runtime.hasConfiguredAuth("test-int")).toBe(true);
      const after = await manager.listProviders();
      const configured = after.find((item) => item.id === "test-int")!;
      if (configured.registration !== "registered") throw new Error("expected registered");
      expect(configured.storedCredential).toEqual({ type: "api_key" });
      expect(configured.effectiveAuth?.type).toBe("api_key");
      const removal = await manager.startRemoval("test-int");
      if (!removal.ok) throw new Error("removal failed to start");
      await waitFor(() => manager.getSnapshot(removal.operationId)?.phase === "terminal");
      expect(await runtime.listCredentials()).toEqual([]);
      expect(runtime.hasConfiguredAuth("test-int")).toBe(false);
    } finally {
      manager.dispose();
    }
  });

  it("keeps orphaned credentials removable", async () => {
    const runtime = await createRuntime();
    const manager = new ProviderAuthManager(runtime, { terminalTtlMs: 50 });
    try {
      runtime.registerNativeProvider(apiKeyProvider("temp"));
      const started = await manager.startLogin("temp", "api_key");
      if (!started.ok) throw new Error("start failed");
      await waitFor(() => {
        const snapshot = manager.getSnapshot(started.operationId);
        return (
          snapshot?.kind === "login" && snapshot.phase === "running" && snapshot.prompt !== null
        );
      });
      const snapshot = manager.getSnapshot(started.operationId);
      if (snapshot?.kind !== "login" || snapshot.phase !== "running" || !snapshot.prompt)
        throw new Error("missing prompt");
      manager.answerPrompt(started.operationId, snapshot.prompt.id, "k");
      await waitFor(() => manager.getSnapshot(started.operationId)?.phase === "terminal");
      runtime.unregisterProvider("temp");
      const list: ProviderStatusDto[] = await manager.listProviders();
      const orphan = list.find((entry) => entry.id === "temp")!;
      expect(orphan.registration).toBe("orphaned");
      const removal = await manager.startRemoval("temp");
      expect(removal.ok).toBe(true);
      if (!removal.ok) return;
      await waitFor(() => manager.getSnapshot(removal.operationId)?.phase === "terminal");
      expect(await runtime.listCredentials()).toEqual([]);
    } finally {
      manager.dispose();
    }
  });
});
