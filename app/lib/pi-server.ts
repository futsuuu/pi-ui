import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model, Api } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  getAgentDir,
  type CreateAgentSessionRuntimeFactory,
  type AgentSession,
  type AgentSessionRuntime,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

export type SseEvent =
  | (AgentSessionEvent & { sessionId: string })
  | (PiState & { type: "internal:state" });

export interface PiState {
  cwd: string;
  model: { name: string; provider: string; id: string } | null;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile: string | null;
  sessionId: string | null;
  sessionName: string | null;
  messageCount: number;
}

interface SessionIndexEntry {
  path: string;
  cwd: string;
}

class PiServer {
  private sessions: Map<string, AgentSessionRuntime> = new Map();
  private sessionIndex: Map<string, SessionIndexEntry> = new Map();
  private pendingRuntimes: Map<string, Promise<AgentSessionRuntime | null>> = new Map();
  private modelRuntimePromise: Promise<ModelRuntime>;
  private createRuntimeFactory: CreateAgentSessionRuntimeFactory;
  private sseClients: Set<(event: SseEvent) => void> = new Set();

  constructor() {
    this.modelRuntimePromise = ModelRuntime.create();
    this.createRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd });
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
        })),
        services,
        diagnostics: services.diagnostics,
      };
    };
  }

  private ensureModelRuntime(): Promise<ModelRuntime> {
    return this.modelRuntimePromise;
  }

  private async createRuntime(sessionManager: SessionManager): Promise<AgentSessionRuntime> {
    return createAgentSessionRuntime(this.createRuntimeFactory, {
      cwd: sessionManager.getCwd(),
      agentDir: getAgentDir(),
      sessionManager,
    });
  }

  private subscribeToSession(session: AgentSession, sessionId: string) {
    session.subscribe((event) => {
      this.broadcast({ ...event, sessionId });

      // Broadcast state snapshot on key state changes so the client can
      // update isStreaming, model, thinkingLevel, etc.
      if (
        event.type === "message_start" ||
        event.type === "message_end" ||
        event.type === "turn_end" ||
        event.type === "agent_settled" ||
        event.type === "agent_end" ||
        event.type === "thinking_level_changed" ||
        event.type === "session_info_changed"
      ) {
        void this.broadcastState(sessionId);
      }
    });
  }

  private async broadcastState(sessionId: string) {
    const state = await this.getState(sessionId);
    if (!state) return;
    this.broadcast({ type: "internal:state", ...state });
  }

  /**
   * Ensure a runtime exists for the given session ID.
   * Checks the in-memory map, then the index (populated by getSessionsList),
   * then falls back to scanning session files on disk.
   *
   * @returns null if session not found, otherwise the runtime
   */
  async ensureRuntime(sessionId: string): Promise<AgentSessionRuntime | null> {
    // 1. Check already-created runtimes
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    // 2. Check whether another concurrent call is already creating this runtime
    const pending = this.pendingRuntimes.get(sessionId);
    if (pending) return pending;

    // 3. Create the runtime and cache the promise so concurrent callers share it
    const promise = this.createRuntimeForSession(sessionId);
    this.pendingRuntimes.set(sessionId, promise);

    try {
      const runtime = await promise;
      return runtime;
    } finally {
      this.pendingRuntimes.delete(sessionId);
    }
  }

  /**
   * @returns null if session not found, otherwise the runtime
   */
  private async createRuntimeForSession(sessionId: string): Promise<AgentSessionRuntime | null> {
    const entry = this.sessionIndex.get(sessionId);
    if (entry) {
      const sessionManager = SessionManager.open(entry.path, undefined, entry.cwd);
      const runtime = await this.createRuntime(sessionManager);
      this.sessions.set(sessionId, runtime);
      this.subscribeToSession(runtime.session, sessionId);
      return runtime;
    }

    // Fallback: scan all projects
    const allSessions = await SessionManager.listAll();
    const found = allSessions.find((s) => s.id === sessionId);
    if (!found) return null;

    const cwd = found.cwd || "";
    this.sessionIndex.set(sessionId, { path: found.path, cwd });
    const sessionManager = SessionManager.open(found.path, undefined, cwd || undefined);
    const runtime = await this.createRuntime(sessionManager);
    this.sessions.set(sessionId, runtime);
    this.subscribeToSession(runtime.session, sessionId);
    return runtime;
  }

  /** Create a brand-new session for the given working directory. */
  async createNewSession(cwd: string): Promise<string> {
    const sessionManager = SessionManager.create(cwd);
    const runtime = await this.createRuntime(sessionManager);
    const sessionId = runtime.session.sessionId;
    const sessionFile = runtime.session.sessionFile ?? "";

    this.sessions.set(sessionId, runtime);
    this.sessionIndex.set(sessionId, { path: sessionFile, cwd });
    this.subscribeToSession(runtime.session, sessionId);
    await this.broadcastState(sessionId);

    return sessionId;
  }

  /** Open an existing session file and return its ID. */
  async openSession(sessionPath: string): Promise<string> {
    const sessionManager = SessionManager.open(sessionPath);
    const runtime = await this.createRuntime(sessionManager);
    const sessionId = runtime.session.sessionId;
    const cwd = runtime.cwd;

    this.sessions.set(sessionId, runtime);
    this.sessionIndex.set(sessionId, { path: sessionPath, cwd });
    this.subscribeToSession(runtime.session, sessionId);
    await this.broadcastState(sessionId);

    return sessionId;
  }

  /** Dispose a single session. */
  async disposeSession(sessionId: string) {
    const runtime = this.sessions.get(sessionId);
    if (runtime) {
      await runtime.dispose();
      this.sessions.delete(sessionId);
    }
  }

  async prompt(
    sessionId: string,
    message: string,
    options?: {
      model?: { provider: string; modelId: string };
      thinkingLevel?: ThinkingLevel;
    },
  ) {
    const runtime = await this.ensureRuntime(sessionId);
    if (!runtime) throw new Error(`Session not found: ${sessionId}`);
    await this.applyOptions(runtime.session, options);
    await runtime.session.prompt(message);
  }

  async steer(
    sessionId: string,
    message: string,
    options?: {
      model?: { provider: string; modelId: string };
      thinkingLevel?: ThinkingLevel;
    },
  ) {
    const runtime = await this.ensureRuntime(sessionId);
    if (!runtime) throw new Error(`Session not found: ${sessionId}`);
    await this.applyOptions(runtime.session, options);
    await runtime.session.steer(message);
  }

  async followUp(
    sessionId: string,
    message: string,
    options?: {
      model?: { provider: string; modelId: string };
      thinkingLevel?: ThinkingLevel;
    },
  ) {
    const runtime = await this.ensureRuntime(sessionId);
    if (!runtime) throw new Error(`Session not found: ${sessionId}`);
    await this.applyOptions(runtime.session, options);
    await runtime.session.followUp(message);
  }

  private async applyOptions(
    session: AgentSession,
    options?: {
      model?: { provider: string; modelId: string };
      thinkingLevel?: ThinkingLevel;
    },
  ) {
    if (!options) return;
    if (options.model) {
      const mr = await this.ensureModelRuntime();
      const model = mr.getModel(options.model.provider, options.model.modelId);
      if (model) {
        await session.setModel(model);
      }
    }
    if (options.thinkingLevel) {
      session.setThinkingLevel(options.thinkingLevel);
    }
  }

  async abort(sessionId: string) {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    await runtime.session.abort();
  }

  async getState(sessionId: string): Promise<PiState | null> {
    const runtime = await this.ensureRuntime(sessionId);
    if (!runtime) return null;
    const session = runtime.session;
    return {
      cwd: runtime.cwd,
      model: session.model
        ? {
            name: session.model.name,
            provider: session.model.provider,
            id: session.model.id,
          }
        : null,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      sessionFile: session.sessionFile ?? null,
      sessionId: session.sessionId,
      sessionName: session.sessionName ?? null,
      messageCount: session.messages.length,
    };
  }

  async getMessages(sessionId: string): Promise<AgentMessage[]> {
    const runtime = await this.ensureRuntime(sessionId);
    return runtime?.session.messages ?? [];
  }

  async getSessionsList(dir: string) {
    const sessions = await SessionManager.list(dir);
    for (const s of sessions) {
      this.sessionIndex.set(s.id, { path: s.path, cwd: s.cwd || dir });
    }
    return sessions.map((s) => ({
      id: s.id,
      path: s.path,
      firstMessage: s.firstMessage?.slice(0, 100) ?? "",
      messageCount: s.messageCount,
      timestamp: new Date(s.created).getTime(),
    }));
  }

  async getModels(): Promise<readonly Model<Api>[]> {
    const mr = await this.ensureModelRuntime();
    return mr.getAvailable();
  }

  subscribe(callback: (event: SseEvent) => void): () => void {
    this.sseClients.add(callback);
    return () => this.sseClients.delete(callback);
  }

  private broadcast(event: SseEvent) {
    for (const client of this.sseClients) {
      try {
        client(event);
      } catch {
        // ignore disconnected clients
      }
    }
  }

  async dispose() {
    for (const runtime of this.sessions.values()) {
      await runtime.dispose();
    }
    this.sessions.clear();
    this.sessionIndex.clear();
  }
}

let instance: PiServer | null = null;

export function getPiServer(): PiServer {
  // Preserve singleton across HMR updates via import.meta.hot.data
  if (!instance) {
    instance = import.meta.hot?.data.piServer ?? new PiServer();
    if (import.meta.hot) {
      import.meta.hot.data.piServer = instance;
    }
  }
  return instance!;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance = null;
  });
}
