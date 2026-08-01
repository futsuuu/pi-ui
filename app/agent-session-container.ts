import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";

export class AgentSessionContainer {
  // We should not expose `AgentSessionRuntime` because it can modify the inner `session` field.
  private runtimes: Map<string, Promise<AgentSessionRuntime | null>> = new Map();
  private listeners: Set<(sessionId: string, event: AgentSessionEvent) => void> = new Set();

  private constructor(private createRuntimeFactory: CreateAgentSessionRuntimeFactory) {}

  public async listInfo(dir: string) {
    const sessions = await SessionManager.list(dir);
    return sessions.map((s) => ({
      id: s.id,
      firstMessage: s.firstMessage.slice(0, 100),
      messageCount: s.messageCount,
      timestamp: s.modified.getTime(),
    }));
  }

  public subscribe(callback: (sessionId: string, event: AgentSessionEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private broadcast(sessionId: string, event: AgentSessionEvent) {
    for (const listener of this.listeners) {
      try {
        listener(sessionId, event);
      } catch {
        // ignore disconnected clients
      }
    }
  }

  public static async create() {
    const modelRuntime = await ModelRuntime.create({
      allowModelNetwork: true,
    });
    return new AgentSessionContainer(async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd, modelRuntime });
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      });
      return {
        ...result,
        services,
        diagnostics: services.diagnostics,
      };
    });
  }

  public async create(cwd: string) {
    const sessionManager = SessionManager.create(cwd);
    const runtime = await createAgentSessionRuntime(this.createRuntimeFactory, {
      cwd: sessionManager.getCwd(),
      agentDir: getAgentDir(),
      sessionManager,
    });
    const sessionId = runtime.session.sessionId;
    this.runtimes.set(sessionId, Promise.resolve(runtime));
    runtime.session.subscribe((event) => this.broadcast(sessionId, event));
    return runtime.session;
  }

  public async get(sessionId: string, hints: { cwd?: string } = {}) {
    const runtime = await this.getRuntime(sessionId, hints);
    return runtime ? runtime.session : null;
  }

  private getRuntime(sessionId: string, hints: { cwd?: string } = {}) {
    const existing = this.runtimes.get(sessionId);
    if (existing) {
      return existing;
    }
    const promise = this.getRuntimeInner(sessionId, hints);
    this.runtimes.set(sessionId, promise);
    void promise.catch(() => {
      if (this.runtimes.get(sessionId) === promise) {
        this.runtimes.delete(sessionId);
      }
    });
    return promise;
  }

  private async getRuntimeInner(sessionId: string, hints: { cwd?: string } = {}) {
    const infoList = hints.cwd
      ? await SessionManager.list(hints.cwd)
      : await SessionManager.listAll();
    const found = infoList.find((info) => info.id === sessionId);
    if (!found) {
      return null;
    }
    const sessionManager = SessionManager.open(found.path);
    const runtime = await createAgentSessionRuntime(this.createRuntimeFactory, {
      cwd: sessionManager.getCwd(),
      agentDir: getAgentDir(),
      sessionManager,
    });
    runtime.session.subscribe((event) => this.broadcast(sessionId, event));
    return runtime;
  }

  public async dispose(sessionId: string) {
    const promise = this.runtimes.get(sessionId);
    if (!promise) return;
    this.runtimes.delete(sessionId);
    const runtime = await promise;
    if (runtime) {
      await runtime.dispose();
    }
  }
}
