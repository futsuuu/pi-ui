import { readdir, writeFile, readFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

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
} from "@earendil-works/pi-coding-agent";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type SseEvent = {
  type: string;
  [key: string]: unknown;
};

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
  ready: boolean;
  error: string | null;
}

interface RecentDir {
  path: string;
  lastOpened: number;
}

const RECENT_DIRS_FILE = ".pi-ui-recent-dirs.json";

class PiServer {
  private runtime: AgentSessionRuntime | null = null;
  private session: AgentSession | null = null;
  private modelRuntime: ModelRuntime | null = null;
  private _cwd: string = process.cwd();
  private _ready: boolean = false;
  private _error: string | null = null;
  private sseClients: Set<(event: SseEvent) => void> = new Set();
  private recentDirs: RecentDir[] = [];
  private recentDirsPath: string;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.recentDirsPath = path.join(homedir(), RECENT_DIRS_FILE);
    void this.loadRecentDirs();
  }

  get cwd() {
    return this._cwd;
  }
  get ready() {
    return this._ready;
  }
  get error() {
    return this._error;
  }

  subscribe(callback: (event: SseEvent) => void): () => void {
    this.sseClients.add(callback);
    return () => this.sseClients.delete(callback);
  }

  private broadcast(event: SseEvent) {
    for (const client of this.sseClients) {
      try {
        client(event);
      } catch {}
    }
  }

  private async loadRecentDirs() {
    try {
      const data = await readFile(this.recentDirsPath, "utf-8");
      this.recentDirs = JSON.parse(data);
    } catch {
      this.recentDirs = [];
    }
  }

  private async saveRecentDirs() {
    try {
      await mkdir(path.dirname(this.recentDirsPath), { recursive: true });
      await writeFile(this.recentDirsPath, JSON.stringify(this.recentDirs, null, 2));
    } catch {}
  }

  getRecentDirs(): RecentDir[] {
    return this.recentDirs.slice(0, 10);
  }

  async addRecentDir(dirPath: string) {
    this.recentDirs = this.recentDirs.filter((d) => d.path !== dirPath);
    this.recentDirs.unshift({ path: dirPath, lastOpened: Date.now() });
    if (this.recentDirs.length > 20) this.recentDirs = this.recentDirs.slice(0, 20);
    await this.saveRecentDirs();
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized && this._ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize(this._cwd);
    return this.initPromise;
  }

  async initialize(cwd: string) {
    this._cwd = cwd;
    this._ready = false;
    this._error = null;
    this.initialized = true;

    try {
      await this.addRecentDir(cwd);

      this.modelRuntime = await ModelRuntime.create();

      const createRuntime: CreateAgentSessionRuntimeFactory = async ({
        cwd,
        sessionManager,
        sessionStartEvent,
      }) => {
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

      this.runtime = await createAgentSessionRuntime(createRuntime, {
        cwd,
        agentDir: getAgentDir(),
        sessionManager: SessionManager.create(cwd),
      });

      this.session = this.runtime.session;

      this.session.subscribe((event) => {
        this.broadcast(event as unknown as SseEvent);
      });

      this._ready = true;
      this.broadcast({ type: "pi:state", ...this.getState() });
    } catch (err) {
      this._error = String(err);
      this._ready = false;
      console.error("Failed to initialize Pi:", err);
    }
  }

  getState(): PiState {
    return {
      cwd: this._cwd,
      model: this.session?.model
        ? {
            name: this.session.model.name ?? "",
            provider: this.session.model.provider ?? "",
            id: this.session.model.id ?? "",
          }
        : null,
      thinkingLevel: (this.session?.thinkingLevel as ThinkingLevel) ?? "medium",
      isStreaming: this.session?.isStreaming ?? false,
      isCompacting: false,
      sessionFile: this.session?.sessionFile ?? null,
      sessionId: this.session?.sessionId ?? null,
      sessionName: null,
      messageCount: this.session?.messages?.length ?? 0,
      ready: this._ready,
      error: this._error,
    };
  }

  async getModels() {
    await this.ensureInitialized();
    if (!this.modelRuntime) return [];
    return this.modelRuntime.getAvailable();
  }

  async prompt(
    message: string,
    options?: { model?: { provider: string; modelId: string }; thinkingLevel?: ThinkingLevel },
  ) {
    await this.ensureInitialized();
    if (!this.session) return;
    try {
      await this.applyOptions(options);
      await this.session.prompt(message);
    } catch (err) {
      console.error("Prompt error:", err);
    }
  }

  async steer(
    message: string,
    options?: { model?: { provider: string; modelId: string }; thinkingLevel?: ThinkingLevel },
  ) {
    await this.ensureInitialized();
    if (!this.session) return;
    try {
      await this.applyOptions(options);
      await this.session.steer(message);
    } catch (err) {
      console.error("Steer error:", err);
    }
  }

  async followUp(
    message: string,
    options?: { model?: { provider: string; modelId: string }; thinkingLevel?: ThinkingLevel },
  ) {
    await this.ensureInitialized();
    if (!this.session) return;
    try {
      await this.applyOptions(options);
      await this.session.followUp(message);
    } catch (err) {
      console.error("FollowUp error:", err);
    }
  }

  private async applyOptions(options?: {
    model?: { provider: string; modelId: string };
    thinkingLevel?: ThinkingLevel;
  }) {
    if (!this.session || !this.modelRuntime || !options) return;
    if (options.model) {
      const model = this.modelRuntime.getModel(options.model.provider, options.model.modelId);
      if (model) {
        await this.session.setModel(model);
      }
    }
    if (options.thinkingLevel) {
      this.session.setThinkingLevel(options.thinkingLevel);
    }
  }

  async abort() {
    await this.ensureInitialized();
    if (!this.session) return;
    await this.session.abort();
  }

  async getSessionsList() {
    await this.ensureInitialized();
    try {
      // Use list() with current cwd to filter sessions for this project only
      const sessions = await SessionManager.list(this._cwd);
      return sessions.map((s) => ({
        id: s.id,
        path: s.path,
        firstMessage: s.firstMessage?.slice(0, 100) ?? "",
        messageCount: s.messageCount,
        timestamp: new Date(s.created).getTime(),
      }));
    } catch {
      return [];
    }
  }

  async switchSession(sessionPath: string) {
    await this.ensureInitialized();
    if (!this.runtime) return;
    try {
      await this.runtime.switchSession(sessionPath);
      this.session = this.runtime.session;

      // Re-subscribe to new session events
      this.session.subscribe((event) => {
        this.broadcast(event as unknown as SseEvent);
      });

      this.broadcast({ type: "pi:state", ...this.getState() });
    } catch (err) {
      console.error("Switch session error:", err);
    }
  }

  async newSession() {
    await this.ensureInitialized();
    if (!this.runtime) return;
    try {
      await this.runtime.newSession();
      this.session = this.runtime.session;
      this.session.subscribe((event) => {
        this.broadcast(event as unknown as SseEvent);
      });
      this.broadcast({ type: "pi:state", ...this.getState() });
    } catch (err) {
      console.error("New session error:", err);
    }
  }

  async changeCwd(newCwd: string) {
    this.session?.dispose();
    this.initialized = false;
    this.initPromise = null;
    await this.initialize(newCwd);
  }

  getMessages(): unknown[] {
    if (!this.session) return [];
    return this.session.messages ?? [];
  }

  async listDirectory(
    dirPath: string,
  ): Promise<{ name: string; path: string; isDirectory: boolean }[]> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const result = entries
        .filter((e) => e.name.charAt(0) !== ".")
        .map((e) => ({
          name: e.name,
          path: path.join(dirPath, e.name),
          isDirectory: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
      return result;
    } catch {
      return [];
    }
  }

  getHomeDir(): string {
    return homedir();
  }

  dispose() {
    this.session?.dispose();
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
