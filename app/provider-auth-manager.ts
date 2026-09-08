import { randomUUID } from "node:crypto";

import type { AuthEvent, AuthPrompt, AuthType } from "@earendil-works/pi-ai";
import { CredentialSynchronizationError, type ModelRuntime } from "@earendil-works/pi-coding-agent";

export type AuthTypeDto = "api_key" | "oauth";

export type AuthMethodDto = {
  type: AuthTypeDto;
  label: string;
};

export type EffectiveAuthDto = {
  type: AuthTypeDto;
  source: {
    kind:
      | "stored"
      | "runtime"
      | "environment"
      | "fallback"
      | "models_json_key"
      | "models_json_command";
    label?: string;
  } | null;
};

export type ProviderStatusDto =
  | {
      registration: "registered";
      id: string;
      name: string;
      methods: readonly AuthMethodDto[];
      storedCredential: { type: AuthTypeDto } | null;
      effectiveAuth: EffectiveAuthDto | null;
    }
  | {
      registration: "orphaned";
      id: string;
      name: string;
      methods: readonly [];
      storedCredential: { type: AuthTypeDto };
      effectiveAuth: null;
    };

export type PromptSnapshot = {
  id: number;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
};

export type OperationSnapshot =
  | {
      operationId: string;
      kind: "login";
      providerId: string;
      providerName: string;
      authType: AuthTypeDto;
      phase: "running";
      prompt: PromptSnapshot | null;
      events: readonly AuthEvent[];
    }
  | {
      operationId: string;
      kind: "login";
      providerId: string;
      providerName: string;
      authType: AuthTypeDto;
      phase: "refreshing_catalog";
      events: readonly AuthEvent[];
    }
  | {
      operationId: string;
      kind: "login";
      providerId: string;
      providerName: string;
      authType: AuthTypeDto;
      phase: "terminal";
      outcome: "success" | "warning" | "failure" | "cancelled" | "timeout";
      message: string | null;
      events: readonly AuthEvent[];
    }
  | {
      operationId: string;
      kind: "removal";
      providerId: string;
      providerName: string;
      phase: "running";
    }
  | {
      operationId: string;
      kind: "removal";
      providerId: string;
      providerName: string;
      phase: "terminal";
      outcome: "success" | "warning" | "failure";
      message: string | null;
    };

export type StartResult =
  | { ok: true; operationId: string }
  | { ok: false; error: "conflict"; operationId: string }
  | { ok: false; error: "unknown_provider" | "unsupported_auth" | "no_stored_credential" };

export type MutationResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "stale_prompt" | "invalid_state" | "incompatible_kind";
    };

export type RuntimePort = Pick<
  ModelRuntime,
  | "getProviders"
  | "listCredentials"
  | "hasConfiguredAuth"
  | "isUsingOAuth"
  | "getProviderAuthStatus"
  | "login"
  | "logout"
  | "refresh"
>;

type PendingPrompt = {
  id: number;
  snapshot: PromptSnapshot;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  onPromptAbort: () => void;
  onOperationAbort: () => void;
  promptSignal: AbortSignal | undefined;
};

type LoginRunning = {
  kind: "login";
  phase: "running";
  operationId: string;
  providerId: string;
  providerName: string;
  authType: AuthTypeDto;
  controller: AbortController;
  nextPromptId: number;
  pending: PendingPrompt | null;
  events: AuthEvent[];
  timer: ReturnType<typeof setTimeout> | undefined;
  settle: () => void;
  done: Promise<void>;
};

type LoginRefreshing = {
  kind: "login";
  phase: "refreshing_catalog";
  operationId: string;
  providerId: string;
  providerName: string;
  authType: AuthTypeDto;
  controller: AbortController;
  refreshController: AbortController;
  events: AuthEvent[];
  timer: ReturnType<typeof setTimeout> | undefined;
  settle: () => void;
  done: Promise<void>;
};

type LoginTerminal = {
  kind: "login";
  phase: "terminal";
  operationId: string;
  providerId: string;
  providerName: string;
  authType: AuthTypeDto;
  outcome: "success" | "warning" | "failure" | "cancelled" | "timeout";
  message: string | null;
  events: AuthEvent[];
  timer: ReturnType<typeof setTimeout> | undefined;
  settle: () => void;
  done: Promise<void>;
};

type RemovalRunning = {
  kind: "removal";
  phase: "running";
  operationId: string;
  providerId: string;
  providerName: string;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | undefined;
  settle: () => void;
  done: Promise<void>;
};

type RemovalTerminal = {
  kind: "removal";
  phase: "terminal";
  operationId: string;
  providerId: string;
  providerName: string;
  outcome: "success" | "warning" | "failure";
  message: string | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  settle: () => void;
  done: Promise<void>;
};

type CurrentOperation =
  | LoginRunning
  | LoginRefreshing
  | LoginTerminal
  | RemovalRunning
  | RemovalTerminal;

const MAX_EVENTS = 50;

function toPromptSnapshot(id: number, prompt: AuthPrompt): PromptSnapshot {
  switch (prompt.type) {
    case "text":
    case "secret":
    case "manual_code":
      return prompt.placeholder === undefined
        ? { id, type: prompt.type, message: prompt.message }
        : { id, type: prompt.type, message: prompt.message, placeholder: prompt.placeholder };
    case "select":
      return {
        id,
        type: "select",
        message: prompt.message,
        options: prompt.options.map((option) =>
          option.description === undefined
            ? { id: option.id, label: option.label }
            : { id: option.id, label: option.label, description: option.description },
        ),
      };
  }
}

function isActive(operation: CurrentOperation): boolean {
  return operation.phase === "running" || operation.phase === "refreshing_catalog";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 500);
  return fallback;
}

export class ProviderAuthManager {
  private current: CurrentOperation | undefined;
  private readonly loginIdleTimeoutMs: number;
  private readonly terminalTtlMs: number;
  private readonly catalogRefreshTimeoutMs: number;
  private readonly removalTimeoutMs: number;

  constructor(
    private readonly runtime: RuntimePort,
    options?: {
      loginIdleTimeoutMs?: number;
      terminalTtlMs?: number;
      catalogRefreshTimeoutMs?: number;
      removalTimeoutMs?: number;
    },
  ) {
    this.loginIdleTimeoutMs = options?.loginIdleTimeoutMs ?? 5 * 60 * 1000;
    this.terminalTtlMs = options?.terminalTtlMs ?? 2 * 60 * 1000;
    this.catalogRefreshTimeoutMs = options?.catalogRefreshTimeoutMs ?? 30_000;
    this.removalTimeoutMs = options?.removalTimeoutMs ?? 30_000;
  }

  async listProviders(): Promise<ProviderStatusDto[]> {
    const providers = this.runtime.getProviders();
    const stored = await this.runtime.listCredentials();
    const storedById = new Map(stored.map((entry) => [entry.providerId, entry.type]));
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const result: ProviderStatusDto[] = [];
    for (const provider of providers) {
      const methods: AuthMethodDto[] = [];
      if (provider.auth.apiKey?.login) {
        methods.push({ type: "api_key", label: provider.auth.apiKey.name });
      }
      if (provider.auth.oauth) {
        methods.push({
          type: "oauth",
          label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name,
        });
      }
      const storedType = storedById.get(provider.id);
      const storedCredential = storedType ? { type: storedType } : null;
      let effectiveAuth: EffectiveAuthDto | null = null;
      if (this.runtime.hasConfiguredAuth(provider.id)) {
        const type: AuthTypeDto = this.runtime.isUsingOAuth(provider.id) ? "oauth" : "api_key";
        const status = this.runtime.getProviderAuthStatus(provider.id);
        effectiveAuth = status.source
          ? status.label === undefined
            ? { type, source: { kind: status.source } }
            : { type, source: { kind: status.source, label: status.label } }
          : { type, source: null };
      }
      result.push({
        registration: "registered",
        id: provider.id,
        name: provider.name,
        methods,
        storedCredential,
        effectiveAuth,
      });
    }
    for (const entry of stored) {
      if (byId.has(entry.providerId)) continue;
      result.push({
        registration: "orphaned",
        id: entry.providerId,
        name: entry.providerId,
        methods: [],
        storedCredential: { type: entry.type },
        effectiveAuth: null,
      });
    }
    result.sort((a, b) => a.id.localeCompare(b.id));
    return result;
  }

  startLogin(providerId: string, type: AuthTypeDto): Promise<StartResult> {
    const active = this.current;
    if (active && isActive(active)) {
      return Promise.resolve({
        ok: false as const,
        error: "conflict" as const,
        operationId: active.operationId,
      });
    }
    const provider = this.runtime.getProviders().find((entry) => entry.id === providerId);
    if (!provider) {
      return Promise.resolve({ ok: false as const, error: "unknown_provider" as const });
    }
    const supported =
      type === "api_key"
        ? provider.auth.apiKey?.login !== undefined
        : provider.auth.oauth !== undefined;
    if (!supported) {
      return Promise.resolve({ ok: false as const, error: "unsupported_auth" as const });
    }
    if (active?.phase === "terminal") {
      this.clearTimer(active);
    }
    const operationId = randomUUID();
    const controller = new AbortController();
    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const operation: LoginRunning = {
      kind: "login",
      phase: "running",
      operationId,
      providerId,
      providerName: provider.name,
      authType: type,
      controller,
      nextPromptId: 1,
      pending: null,
      events: [],
      timer: undefined,
      settle,
      done,
    };
    operation.done.catch(() => undefined);
    this.current = operation;
    this.armIdleTimer(operation);
    void this.runLogin(operation, type);
    return Promise.resolve({ ok: true as const, operationId });
  }

  async startRemoval(providerId: string): Promise<StartResult> {
    const active = this.current;
    if (active && isActive(active)) {
      return { ok: false, error: "conflict", operationId: active.operationId };
    }
    const stored = await this.runtime.listCredentials();
    if (!stored.some((entry) => entry.providerId === providerId)) {
      return { ok: false, error: "no_stored_credential" };
    }
    const again = this.current;
    if (again && isActive(again)) {
      return { ok: false, error: "conflict", operationId: again.operationId };
    }
    if (again?.phase === "terminal") {
      this.clearTimer(again);
    }
    const provider = this.runtime.getProviders().find((entry) => entry.id === providerId);
    const operationId = randomUUID();
    const controller = new AbortController();
    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const operation: RemovalRunning = {
      kind: "removal",
      phase: "running",
      operationId,
      providerId,
      providerName: provider?.name ?? providerId,
      controller,
      timer: undefined,
      settle,
      done,
    };
    operation.done.catch(() => undefined);
    this.current = operation;
    this.armRemovalTimer(operation);
    void this.runRemoval(operation);
    return { ok: true, operationId };
  }

  getSnapshot(operationId: string): OperationSnapshot | undefined {
    const operation = this.current;
    if (!operation || operation.operationId !== operationId) return undefined;
    switch (operation.kind) {
      case "login":
        if (operation.phase === "running") {
          return {
            operationId: operation.operationId,
            kind: "login",
            providerId: operation.providerId,
            providerName: operation.providerName,
            authType: operation.authType,
            phase: "running",
            prompt: operation.pending ? operation.pending.snapshot : null,
            events: [...operation.events],
          };
        }
        if (operation.phase === "refreshing_catalog") {
          return {
            operationId: operation.operationId,
            kind: "login",
            providerId: operation.providerId,
            providerName: operation.providerName,
            authType: operation.authType,
            phase: "refreshing_catalog",
            events: [...operation.events],
          };
        }
        return {
          operationId: operation.operationId,
          kind: "login",
          providerId: operation.providerId,
          providerName: operation.providerName,
          authType: operation.authType,
          phase: "terminal",
          outcome: operation.outcome,
          message: operation.message,
          events: [...operation.events],
        };
      case "removal":
        if (operation.phase === "running") {
          return {
            operationId: operation.operationId,
            kind: "removal",
            providerId: operation.providerId,
            providerName: operation.providerName,
            phase: "running",
          };
        }
        return {
          operationId: operation.operationId,
          kind: "removal",
          providerId: operation.providerId,
          providerName: operation.providerName,
          phase: "terminal",
          outcome: operation.outcome,
          message: operation.message,
        };
    }
  }

  answerPrompt(operationId: string, promptId: number, answer: string): MutationResult {
    const operation = this.current;
    if (!operation || operation.operationId !== operationId) {
      return { ok: false, error: "not_found" };
    }
    if (operation.kind !== "login") {
      return { ok: false, error: "incompatible_kind" };
    }
    if (operation.phase !== "running") {
      return { ok: false, error: "invalid_state" };
    }
    const pending = operation.pending;
    if (!pending || pending.id !== promptId) {
      return { ok: false, error: "stale_prompt" };
    }
    operation.pending = null;
    pending.promptSignal?.removeEventListener("abort", pending.onPromptAbort);
    operation.controller.signal.removeEventListener("abort", pending.onOperationAbort);
    this.resetIdleTimer(operation);
    pending.resolve(answer);
    return { ok: true };
  }

  cancelLogin(operationId: string): MutationResult {
    const operation = this.current;
    if (!operation || operation.operationId !== operationId) {
      return { ok: false, error: "not_found" };
    }
    if (operation.kind !== "login") {
      return { ok: false, error: "incompatible_kind" };
    }
    if (operation.phase !== "running") {
      return { ok: false, error: "invalid_state" };
    }
    this.rejectPending(operation, new Error("Login cancelled"));
    operation.controller.abort(new Error("Login cancelled"));
    this.toLoginTerminal(operation, "cancelled", "Login was cancelled.");
    return { ok: true };
  }

  dispose(): void {
    const operation = this.current;
    if (!operation) return;
    this.clearTimer(operation);
    if (operation.kind === "login" && operation.phase === "running" && operation.pending) {
      const pending = operation.pending;
      operation.pending = null;
      pending.promptSignal?.removeEventListener("abort", pending.onPromptAbort);
      operation.controller.signal.removeEventListener("abort", pending.onOperationAbort);
      pending.reject(new Error("Server is shutting down"));
    }
    if (operation.kind === "login" && operation.phase === "refreshing_catalog") {
      operation.refreshController.abort(new Error("Server is shutting down"));
      try {
        operation.controller.abort(new Error("Server is shutting down"));
      } catch {
        operation.settle();
      }
    } else if (operation.phase === "running") {
      try {
        operation.controller.abort(new Error("Server is shutting down"));
      } catch {
        operation.settle();
      }
    }
    operation.settle();
    if (this.current === operation) {
      this.current = undefined;
    }
  }

  private clearTimer(operation: CurrentOperation): void {
    if (operation.timer !== undefined) {
      clearTimeout(operation.timer);
      operation.timer = undefined;
    }
  }

  private armIdleTimer(operation: LoginRunning): void {
    this.clearTimer(operation);
    const timer = setTimeout(() => {
      if (this.current !== operation || operation.phase !== "running") return;
      this.rejectPending(operation, new Error("Login timed out"));
      try {
        operation.controller.abort(new Error("Login timed out"));
      } catch {}
      this.toLoginTerminal(operation, "timeout", "Login timed out due to inactivity.");
    }, this.loginIdleTimeoutMs);
    timer.unref?.();
    operation.timer = timer;
  }

  private resetIdleTimer(operation: LoginRunning): void {
    if (this.current !== operation || operation.phase !== "running") return;
    this.armIdleTimer(operation);
  }

  private armRemovalTimer(operation: RemovalRunning): void {
    this.clearTimer(operation);
    const timer = setTimeout(() => {
      if (this.current !== operation || operation.phase !== "running") return;
      try {
        operation.controller.abort(new Error("Removal timed out"));
      } catch {}
      this.toRemovalTerminal(operation, "failure", "Removal timed out.");
    }, this.removalTimeoutMs);
    timer.unref?.();
    operation.timer = timer;
  }

  private armTerminalTimer(operation: CurrentOperation): void {
    this.clearTimer(operation);
    const timer = setTimeout(() => {
      if (this.current === operation) {
        this.current = undefined;
      }
      operation.settle();
    }, this.terminalTtlMs);
    timer.unref?.();
    operation.timer = timer;
  }

  private rejectPending(operation: LoginRunning, error: Error): void {
    const pending = operation.pending;
    if (!pending) return;
    operation.pending = null;
    pending.promptSignal?.removeEventListener("abort", pending.onPromptAbort);
    operation.controller.signal.removeEventListener("abort", pending.onOperationAbort);
    pending.reject(error);
  }

  private pushEvent(operation: LoginRunning | LoginRefreshing, event: AuthEvent): void {
    operation.events.push(event);
    if (operation.events.length > MAX_EVENTS) {
      operation.events.splice(0, operation.events.length - MAX_EVENTS);
    }
  }

  private toLoginTerminal(
    operation: LoginRunning | LoginRefreshing,
    outcome: LoginTerminal["outcome"],
    message: string | null,
  ): void {
    this.clearTimer(operation);
    const terminal: LoginTerminal = {
      kind: "login",
      phase: "terminal",
      operationId: operation.operationId,
      providerId: operation.providerId,
      providerName: operation.providerName,
      authType: operation.authType,
      outcome,
      message,
      events: operation.events,
      timer: undefined,
      settle: operation.settle,
      done: operation.done,
    };
    if (this.current === operation) {
      this.current = terminal;
    }
    this.armTerminalTimer(terminal);
  }

  private toRemovalTerminal(
    operation: RemovalRunning,
    outcome: RemovalTerminal["outcome"],
    message: string | null,
  ): void {
    this.clearTimer(operation);
    const terminal: RemovalTerminal = {
      kind: "removal",
      phase: "terminal",
      operationId: operation.operationId,
      providerId: operation.providerId,
      providerName: operation.providerName,
      outcome,
      message,
      timer: undefined,
      settle: operation.settle,
      done: operation.done,
    };
    if (this.current === operation) {
      this.current = terminal;
    }
    this.armTerminalTimer(terminal);
  }

  private async runLogin(operation: LoginRunning, type: AuthTypeDto): Promise<void> {
    const authType: AuthType = type;
    const interaction = {
      signal: operation.controller.signal,
      prompt: (prompt: AuthPrompt): Promise<string> => {
        if (this.current !== operation || operation.phase !== "running") {
          return Promise.reject(new Error("Login is no longer running"));
        }
        if (prompt.signal?.aborted) {
          return Promise.reject(prompt.signal.reason ?? new Error("Prompt was aborted"));
        }
        const id = operation.nextPromptId++;
        const snapshot = toPromptSnapshot(id, prompt);
        this.resetIdleTimer(operation);
        return new Promise<string>((resolve, reject) => {
          const onPromptAbort = () => {
            if (this.current !== operation || operation.phase !== "running") return;
            if (operation.pending?.id !== id) return;
            operation.pending = null;
            prompt.signal?.removeEventListener("abort", onPromptAbort);
            operation.controller.signal.removeEventListener("abort", onOperationAbort);
            this.resetIdleTimer(operation);
            reject(prompt.signal?.reason ?? new Error("Prompt was aborted"));
          };
          const onOperationAbort = () => {
            if (operation.pending?.id !== id) return;
            operation.pending = null;
            prompt.signal?.removeEventListener("abort", onPromptAbort);
            reject(operation.controller.signal.reason ?? new Error("Login was aborted"));
          };
          const pending: PendingPrompt = {
            id,
            snapshot,
            resolve: (answer: string) => {
              prompt.signal?.removeEventListener("abort", onPromptAbort);
              operation.controller.signal.removeEventListener("abort", onOperationAbort);
              resolve(answer);
            },
            reject: (error: Error) => {
              prompt.signal?.removeEventListener("abort", onPromptAbort);
              operation.controller.signal.removeEventListener("abort", onOperationAbort);
              reject(error);
            },
            onPromptAbort,
            onOperationAbort,
            promptSignal: prompt.signal,
          };
          operation.pending = pending;
          prompt.signal?.addEventListener("abort", onPromptAbort, { once: true });
          operation.controller.signal.addEventListener("abort", onOperationAbort, { once: true });
        });
      },
      notify: (event: AuthEvent): void => {
        if (this.current !== operation || operation.phase !== "running") return;
        this.pushEvent(operation, event);
        this.resetIdleTimer(operation);
      },
    };
    try {
      await this.runtime.login(operation.providerId, authType, interaction);
    } catch (error) {
      if (this.current !== operation || operation.phase !== "running") return;
      if (operation.controller.signal.aborted) return;
      if (error instanceof CredentialSynchronizationError) {
        this.toLoginTerminal(
          operation,
          "warning",
          "Credential was saved, but local model state did not synchronize.",
        );
        return;
      }
      this.toLoginTerminal(operation, "failure", errorMessage(error, "Login failed."));
      return;
    }
    if (this.current !== operation || operation.phase !== "running") return;
    if (operation.controller.signal.aborted) return;
    if (operation.pending) {
      const pending = operation.pending;
      operation.pending = null;
      pending.promptSignal?.removeEventListener("abort", pending.onPromptAbort);
      operation.controller.signal.removeEventListener("abort", pending.onOperationAbort);
      pending.reject(new Error("Login completed"));
    }
    this.clearTimer(operation);
    const refreshController = new AbortController();
    const refreshing: LoginRefreshing = {
      kind: "login",
      phase: "refreshing_catalog",
      operationId: operation.operationId,
      providerId: operation.providerId,
      providerName: operation.providerName,
      authType: operation.authType,
      controller: operation.controller,
      refreshController,
      events: operation.events,
      timer: undefined,
      settle: operation.settle,
      done: operation.done,
    };
    this.current = refreshing;
    const onOperationAbort = () => {
      refreshController.abort(operation.controller.signal.reason);
    };
    operation.controller.signal.addEventListener("abort", onOperationAbort, { once: true });
    const timer = setTimeout(() => {
      refreshController.abort(new Error("Catalog refresh timed out"));
    }, this.catalogRefreshTimeoutMs);
    timer.unref?.();
    refreshing.timer = timer;
    try {
      const result = await this.runtime.refresh({
        providers: [operation.providerId],
        force: true,
        signal: refreshController.signal,
      });
      if (this.current !== refreshing) return;
      operation.controller.signal.removeEventListener("abort", onOperationAbort);
      this.clearTimer(refreshing);
      const refreshError = result.errors.get(operation.providerId);
      if (result.aborted || refreshError) {
        this.toLoginTerminal(
          refreshing,
          "warning",
          "Credential was saved, but the model catalog refresh did not complete.",
        );
        return;
      }
      this.toLoginTerminal(refreshing, "success", null);
    } catch (error) {
      if (this.current !== refreshing) return;
      operation.controller.signal.removeEventListener("abort", onOperationAbort);
      this.clearTimer(refreshing);
      if (refreshController.signal.aborted && !operation.controller.signal.aborted) {
        this.toLoginTerminal(
          refreshing,
          "warning",
          "Credential was saved, but the model catalog refresh timed out.",
        );
        return;
      }
      if (error instanceof CredentialSynchronizationError) {
        this.toLoginTerminal(
          refreshing,
          "warning",
          "Credential was saved, but local model state did not synchronize.",
        );
        return;
      }
      this.toLoginTerminal(
        refreshing,
        "warning",
        "Credential was saved, but the model catalog refresh did not complete.",
      );
    }
  }

  private async runRemoval(operation: RemovalRunning): Promise<void> {
    try {
      await this.runtime.logout(operation.providerId, { signal: operation.controller.signal });
    } catch (error) {
      if (this.current !== operation || operation.phase !== "running") return;
      if (operation.controller.signal.aborted) return;
      if (error instanceof CredentialSynchronizationError) {
        this.toRemovalTerminal(
          operation,
          "warning",
          "Stored credential was removed, but local model state did not synchronize.",
        );
        return;
      }
      this.toRemovalTerminal(operation, "failure", errorMessage(error, "Removal failed."));
      return;
    }
    if (this.current !== operation || operation.phase !== "running") return;
    if (operation.controller.signal.aborted) return;
    this.toRemovalTerminal(operation, "success", null);
  }
}
