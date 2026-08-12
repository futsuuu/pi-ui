import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";

import type { TextContent } from "@earendil-works/pi-ai/compat";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type SessionInfo as PersistedSessionInfo,
} from "@earendil-works/pi-coding-agent";

import type { SessionInfo } from "./session-info";

const execFileAsync = promisify(execFile);

/**
 * Delete a session file, trying the `trash` CLI first (moves it to the OS
 * trash), then falling back to permanent deletion. Mirrors Pi's TUI behavior:
 * `trash` is only treated as successful when the file is actually gone, so a
 * missing-path misconfiguration cannot leave the session behind.
 */
async function deleteSessionFile(sessionPath: string): Promise<void> {
  const args = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
  let trashHint: string | null = null;
  try {
    await execFileAsync("trash", args);
    if (!existsSync(sessionPath)) return;
    trashHint = "trash reported success but the session file is still present";
  } catch (error) {
    // `trash` is not installed or failed; keep its error for diagnostics.
    const message = error instanceof Error ? error.message : "";
    const stderr =
      error instanceof Error && "stderr" in error
        ? (String((error as { stderr: unknown }).stderr)
            .trim()
            .split("\n")[0] ?? "")
        : "";
    const detail = stderr || message;
    if (detail) {
      trashHint = `trash: ${detail.slice(0, 200)}`;
    }
  }
  try {
    await unlink(sessionPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(trashHint ? `${message} (${trashHint})` : message);
  }
}

async function findSessionInfo(
  sessionId: string,
  hints: { cwd: string; sessionDir?: string },
): Promise<PersistedSessionInfo | null> {
  // Passing the cwd lets `list` match the session header's cwd when a custom
  // sessionDir is used; without it `resolvePath("")` would fall back to the
  // server process cwd and wrongly filter out sessions.
  const infoList = await SessionManager.list(hints.cwd, hints.sessionDir);
  return infoList.find((info) => info.id === sessionId) ?? null;
}

/** Events broadcast to container subscribers: session events plus session deletion. */
export type ContainerEvent = AgentSessionEvent | { type: "session_deleted" };

export class AgentSessionContainer {
  // We should not expose `AgentSessionRuntime` because it can modify the inner `session` field.
  private runtimes: Map<string, Promise<AgentSessionRuntime | null>> = new Map();
  private listeners: Set<(sessionId: string, event: ContainerEvent) => void> = new Set();

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

  public subscribe(callback: (sessionId: string, event: ContainerEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private broadcast(sessionId: string, event: ContainerEvent) {
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

  /**
   * Build a container with a custom runtime factory. Production uses
   * {@link create}; this is exposed for tests that want to avoid the real
   * model runtime and resource discovery.
   */
  public static withFactory(factory: CreateAgentSessionRuntimeFactory): AgentSessionContainer {
    return new AgentSessionContainer(factory);
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

  /**
   * Current info for all sessions, merging live session info into the
   * persisted list. Never force-loads a runtime: unloaded sessions keep
   * their persisted info only.
   */
  public async currentInfoList(): Promise<SessionInfo[]> {
    const persisted = await SessionManager.listAll();
    return Promise.all(persisted.map((info) => this.infoFromPersisted(info)));
  }

  private async infoFromPersisted(persisted: PersistedSessionInfo): Promise<SessionInfo> {
    const runtime = this.runtimes.get(persisted.id);
    if (runtime) {
      const loaded = await runtime.catch(() => null);
      if (loaded) return sessionInfo(loaded.session);
    }
    return {
      id: persisted.id,
      cwd: persisted.cwd,
      name: persisted.name ?? null,
      firstMessage: persisted.firstMessage,
      messageCount: persisted.messageCount,
      timestamp: persisted.modified.getTime(),
      model: null,
      thinkingLevel: "medium",
      isStreaming: false,
      isCompacting: false,
    };
  }

  /**
   * Current info for a session with a loaded runtime only; `null` when the
   * session is not loaded. Never creates a runtime.
   */
  public async currentInfo(sessionId: string): Promise<SessionInfo | null> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return null;
    const loaded = await runtime.catch(() => null);
    return loaded ? sessionInfo(loaded.session) : null;
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

  /**
   * Delete a session: moves its file to the OS trash when the `trash` CLI is
   * available, otherwise deletes it directly. Any loaded runtime is disposed
   * first so a running chat cannot keep writing to the deleted session.
   * Throws if no session with the given id exists.
   */
  public async delete(sessionId: string, hints: { cwd: string; sessionDir?: string }) {
    const found = await findSessionInfo(sessionId, hints);
    if (!found) {
      throw new Error(`Session ${JSON.stringify(sessionId)} not found`);
    }
    await this.dispose(sessionId);
    await deleteSessionFile(found.path);
    // Only broadcast once the file is actually gone, so a failed deletion
    // cannot leave clients with a removed session.
    this.broadcast(sessionId, { type: "session_deleted" });
  }
}

/**
 * Info for a loaded session, derived from its live state. The persisted file
 * is not read here: `currentInfo` runs per event and must stay cheap.
 */
function sessionInfo(session: AgentSession): SessionInfo {
  const messages = session.messages;
  const firstUser = messages.find((message) => message.role === "user");
  const last = messages[messages.length - 1];
  return {
    id: session.sessionId,
    cwd: session.sessionManager.getCwd(),
    name: session.sessionName ?? null,
    firstMessage: firstUser ? userMessageText(firstUser) : "",
    messageCount: messages.length,
    timestamp: last?.timestamp ?? Date.now(),
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
  };
}

/** Text content of a user message (its string form or its text parts). */
function userMessageText(
  message: Extract<AgentSession["messages"][number], { role: "user" }>,
): string {
  const content = message.content;
  if (typeof content === "string") return content;
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}
