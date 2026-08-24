import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
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
  type SessionEntry,
  type SessionInfo as PersistedSessionInfo,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

import { orderedDisplayKeys } from "./routes/session.$id/message-key";
import type { SessionInfo } from "./session-info";
import {
  SessionViewStateRepository,
  type SessionReadState,
  type SessionViewState,
} from "./session-view-state";

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

/**
 * Finds persisted session information by session ID.
 *
 * @param sessionId - The ID of the session to find
 * @param hints - The working directory and optional session directory used to locate sessions
 * @returns The matching persisted session information, or `null` if no session matches
 */
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

export type ContainerEvent =
  | AgentSessionEvent
  | { type: "session_deleted" }
  | { type: "view_state"; viewState: SessionReadState };

/** Stable empty buffer shared by idle sessions (no current turn in flight). */
const EMPTY_TURN_EVENTS: AgentSessionEvent[] = [];

/**
 * Fold one session event into the current turn's buffer. Returns the new
 * buffer, or `undefined` when the turn ended (buffer cleared). `message_update`
 * and `tool_execution_update` events are coalesced to the newest value per
 * message/tool identity: both carry the full accumulated content, so only the
 * newest matters. The buffer is therefore bounded by the turn's
 * message/tool-event count, not by the streamed text length.
 */
export function applyTurnEvent(
  buffer: readonly AgentSessionEvent[] | undefined,
  event: AgentSessionEvent,
): AgentSessionEvent[] | undefined {
  if (buffer) {
    switch (event.type) {
      case "turn_start":
        // A new turn starts: the previous turn's events are irrelevant now.
        return [event];
      case "message_update": {
        const idx = buffer.findIndex(
          (e) => e.type === "message_update" && sameMessageIdentity(e.message, event.message),
        );
        if (idx !== -1) {
          const next = [...buffer];
          next[idx] = event;
          return next;
        }
        return [...buffer, event];
      }
      case "tool_execution_update": {
        // Tool updates carry the full cumulative partial output per tool call
        // (the bash tool emits one per ~100ms throttle interval), so the newest
        // update per toolCallId is authoritative and the rest can be dropped.
        const idx = buffer.findIndex(
          (e) => e.type === "tool_execution_update" && e.toolCallId === event.toolCallId,
        );
        if (idx !== -1) {
          const next = [...buffer];
          next[idx] = event;
          return next;
        }
        return [...buffer, event];
      }
      case "agent_settled":
        // The run ended; persisted messages cover the turn from now on.
        return undefined;
      default:
        return [...buffer, event];
    }
  }
  return event.type === "turn_start" ? [event] : undefined;
}

export class AgentSessionContainer {
  // We should not expose `AgentSessionRuntime` because it can modify the inner `session` field.
  private runtimes: Map<string, Promise<AgentSessionRuntime | null>> = new Map();
  private listeners: Set<(sessionId: string, event: ContainerEvent) => void> = new Set();
  /**
   * Current turn's events per session, shared across connections. Bounded by
   * the turn's message/tool-event count: `message_update` and
   * `tool_execution_update` events are coalesced to the newest value per
   * message/tool identity. Replaced on `turn_start`, cleared on
   * `agent_settled`, deletion, and runtime disposal.
   */
  private turnBuffers: Map<string, AgentSessionEvent[]> = new Map();

  private constructor(
    private createRuntimeFactory: CreateAgentSessionRuntimeFactory,
    private viewStateRepository: SessionViewStateRepository,
  ) {}

  public async listInfo(dir: string) {
    const sessions = await SessionManager.list(dir);
    return sessions.map((s) => ({
      id: s.id,
      firstMessage: s.firstMessage.slice(0, 100),
      messageCount: s.messageCount,
      timestamp: s.modified.getTime(),
    }));
  }

  /**
   * The working directory recorded for a session, or `null` when no session
   * with this ID exists. Uses the loaded runtime when present and reads the
   * persisted headers otherwise; never loads a runtime.
   */
  public async findSessionCwd(sessionId: string): Promise<string | null> {
    const runtime = this.runtimes.get(sessionId);
    if (runtime) {
      const loaded = await runtime.catch(() => null);
      if (loaded) return loaded.session.sessionManager.getCwd();
    }
    const infos = await SessionManager.listAll();
    return infos.find((info) => info.id === sessionId)?.cwd ?? null;
  }

  public subscribe(callback: (sessionId: string, event: ContainerEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * The current turn's events for a session, for the chat loader. Every
   * session event replaces the buffer with a new array, so each loader call
   * returns the buffer as of that moment; a loader that races the turn keeps
   * the snapshot it read (the correct `[loader read]` point in time). A fresh
   * array on every event also lets the route detect the turn's progress by
   * reference and rebuild on revalidation.
   */
  public getTurnEvents(sessionId: string): AgentSessionEvent[] {
    return this.turnBuffers.get(sessionId) ?? EMPTY_TURN_EVENTS;
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

  /** Keep the per-session turn buffer in sync with the session's events. */
  private handleSessionEvent(sessionId: string, event: AgentSessionEvent) {
    const next = applyTurnEvent(this.turnBuffers.get(sessionId), event);
    if (next) this.turnBuffers.set(sessionId, next);
    else this.turnBuffers.delete(sessionId);
    // A settled message must leave the session unread until a client displays
    // it — even when the session was never opened as a page (no record yet,
    // e.g. a prompt sent through a fetcher). Creating a null-cursor record
    // keeps "no record" meaning "read" (e.g. after a server restart) while
    // still flagging the new message as unread.
    if (
      (event.type === "message_end" || event.type === "tool_execution_end") &&
      this.viewStateRepository.get(sessionId) === null
    ) {
      this.viewStateRepository.set(sessionId, null);
    }
    this.broadcast(sessionId, event);
  }

  public static async create(
    viewStateRepository: SessionViewStateRepository = new SessionViewStateRepository(),
  ) {
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
    }, viewStateRepository);
  }

  /**
   * Build a container with a custom runtime factory. Production uses
   * {@link create}; this is exposed for tests that want to avoid the real
   * model runtime and resource discovery.
   */
  public static withFactory(
    factory: CreateAgentSessionRuntimeFactory,
    viewStateRepository: SessionViewStateRepository = new SessionViewStateRepository(),
  ): AgentSessionContainer {
    return new AgentSessionContainer(factory, viewStateRepository);
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
    runtime.session.subscribe((event) => this.handleSessionEvent(sessionId, event));
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
    runtime.session.subscribe((event) => this.handleSessionEvent(sessionId, event));
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
      if (loaded) return this.loadedInfo(persisted.id, loaded.session);
    }
    const keys = orderedDisplayKeys(
      messageEntries(SessionManager.open(persisted.path).getEntries()),
    );
    const stored = this.viewStateRepository.get(persisted.id);
    const lastDisplayed = stored?.lastDisplayedMessageKey ?? null;
    const latest = keys.length > 0 ? keys[keys.length - 1] : null;
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
      lastDisplayedMessageKey: lastDisplayed,
      latestMessageKey: latest,
      isRead: isReadState(stored, latest),
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
    return loaded ? this.loadedInfo(sessionId, loaded.session) : null;
  }

  private loadedInfo(sessionId: string, session: AgentSession): SessionInfo {
    const keys = orderedDisplayKeys(session.messages, this.turnBuffers.get(sessionId) ?? []);
    const stored = this.viewStateRepository.get(sessionId);
    const lastDisplayed = stored?.lastDisplayedMessageKey ?? null;
    const latest = keys.length > 0 ? keys[keys.length - 1] : null;
    return {
      ...sessionInfo(session),
      lastDisplayedMessageKey: lastDisplayed,
      latestMessageKey: latest,
      isRead: isReadState(stored, latest),
    };
  }

  public async dispose(sessionId: string) {
    const promise = this.runtimes.get(sessionId);
    if (!promise) return;
    this.runtimes.delete(sessionId);
    this.turnBuffers.delete(sessionId);
    const runtime = await promise;
    if (runtime) {
      await runtime.dispose();
    }
  }

  /**
   * Delete a session: moves its file to the OS trash when the `trash` CLI is
   * available, otherwise deletes it directly. Any loaded runtime is disposed
   * first so a running chat cannot keep writing to the deleted session, and
   * the view state is removed only after the file is actually gone (a failed
   * deletion must not lose the display cursor). Throws if no session with
   * the given id exists.
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
    this.turnBuffers.delete(sessionId);
    this.viewStateRepository.delete(sessionId);
    this.broadcast(sessionId, { type: "session_deleted" });
  }

  /**
   * The derived read state for a session: the shared cursor from the
   * repository plus the latest renderable message key of the current
   * projection (loaded runtime messages plus the in-flight turn buffer;
   * persisted entries when the runtime is not loaded). `null` when the
   * session does not exist.
   */
  public async getSessionReadState(
    sessionId: string,
    hints: { cwd?: string; sessionDir?: string } = {},
  ): Promise<SessionReadState | null> {
    const keys = await this.resolveOrderedKeys(sessionId, hints);
    return keys === null ? null : this.readState(sessionId, keys);
  }

  /**
   * Record that a message became visible in a client's viewport. The cursor
   * only moves forward in the current display order: older or unknown keys
   * are ignored, repeated keys are idempotent. A saved cursor that is no
   * longer present (compaction or a branch change) does not block a
   * genuinely observed candidate. Broadcasts the effective read state when
   * the cursor advanced.
   */
  public async markMessageDisplayed(
    sessionId: string,
    messageKey: string,
    hints: { cwd?: string; sessionDir?: string } = {},
  ): Promise<SessionReadState> {
    const keys = await this.resolveOrderedKeys(sessionId, hints);
    if (keys === null) {
      throw new Error(`Session ${JSON.stringify(sessionId)} not found`);
    }
    const candidateIndex = keys.indexOf(messageKey);
    const stored = this.viewStateRepository.get(sessionId)?.lastDisplayedMessageKey ?? null;
    const storedIndex = stored === null ? -1 : keys.indexOf(stored);
    // Unknown candidates and backward moves never advance the cursor; a
    // repeated key (candidateIndex === storedIndex) is an idempotent no-op.
    if (candidateIndex === -1 || storedIndex >= candidateIndex) {
      return this.readState(sessionId, keys);
    }
    this.viewStateRepository.set(sessionId, messageKey);
    const readState = this.readState(sessionId, keys);
    this.broadcast(sessionId, { type: "view_state", viewState: readState });
    return readState;
  }

  private async resolveOrderedKeys(
    sessionId: string,
    hints: { cwd?: string; sessionDir?: string },
  ): Promise<string[] | null> {
    const runtime = this.runtimes.get(sessionId);
    if (runtime) {
      const loaded = await runtime.catch(() => null);
      if (loaded) {
        return orderedDisplayKeys(loaded.session.messages, this.turnBuffers.get(sessionId) ?? []);
      }
    }
    const infoList = hints.cwd
      ? await SessionManager.list(hints.cwd, hints.sessionDir)
      : await SessionManager.listAll();
    const found = infoList.find((info) => info.id === sessionId);
    if (!found) return null;
    return orderedDisplayKeys(messageEntries(SessionManager.open(found.path).getEntries()));
  }

  private readState(sessionId: string, keys: readonly string[]): SessionReadState {
    const stored = this.viewStateRepository.get(sessionId);
    const lastDisplayed = stored?.lastDisplayedMessageKey ?? null;
    const latest = keys.length > 0 ? keys[keys.length - 1] : null;
    return {
      lastDisplayedMessageKey: lastDisplayed,
      latestMessageKey: latest,
      isRead: isReadState(stored, latest),
    };
  }
}

/**
 * Determines whether a session has been read through its latest message.
 *
 * @param stored - The persisted view state, or `null` when no state exists
 * @param latest - The latest message key, or `null` when the session has no messages
 * @returns `true` if no view state exists or the displayed cursor matches the latest message, `false` otherwise
 */
function isReadState(stored: SessionViewState | null, latest: string | null): boolean {
  if (!stored) return true;
  return stored.lastDisplayedMessageKey === latest;
}

/**
 * Builds session metadata from persisted entries and live runtime state.
 *
 * @param session - The loaded agent session
 * @returns Session metadata excluding read-state and message-key fields
 */
function sessionInfo(
  session: AgentSession,
): Omit<SessionInfo, "lastDisplayedMessageKey" | "latestMessageKey" | "isRead"> {
  const entries = session.sessionManager.getEntries();
  let firstMessage: string | undefined;
  let messageCount = 0;
  let lastActivity = 0;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    messageCount++;
    const message = entry.message;
    if (firstMessage === undefined && message.role === "user") {
      // Skip text-less user messages, mirroring the persisted path
      // (SessionManager.list): the first user message with text wins.
      const text = userMessageText(message);
      if (text) firstMessage = text;
    }
    const activity = messageActivityTime(entry);
    if (activity > lastActivity) lastActivity = activity;
  }
  return {
    id: session.sessionId,
    cwd: session.sessionManager.getCwd(),
    name: session.sessionName ?? null,
    firstMessage: firstMessage || "(no messages)",
    messageCount,
    timestamp: lastActivity > 0 ? lastActivity : fallbackModifiedTime(session),
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

/**
 * Last activity time of a message entry, mirroring the persisted
 * `SessionInfo.modified` rule (user/assistant messages only).
 */
function messageActivityTime(entry: SessionMessageEntry): number {
  const message = entry.message;
  if (message.role !== "user" && message.role !== "assistant") return 0;
  if (typeof message.timestamp === "number") return message.timestamp;
  const t = new Date(entry.timestamp).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Modified time when the session has no activity, mirroring the persisted
 * path (SessionManager.list): header timestamp first, then the file's mtime.
 * The `Date.now()` last resort only survives a race where the file
 * disappeared while the runtime is still loaded.
 */
function fallbackModifiedTime(session: AgentSession): number {
  const header = session.sessionManager.getHeader();
  if (header) {
    const t = new Date(header.timestamp).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const file = session.sessionManager.getSessionFile();
  if (file) {
    try {
      return statSync(file).mtime.getTime();
    } catch {
      // Same last resort as before; the file should normally exist here.
    }
  }
  return Date.now();
}

/** Text content of a user message (its string form or its text parts). */
function userMessageText(
  message: Extract<AgentSession["messages"][number], { role: "user" }>,
): string {
  const content = message.content;
  if (typeof content === "string") return content;
  // Join with a space, mirroring the persisted path (SessionManager.list's
  // extractTextContent), so loaded and unloaded sessions show the same text.
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

/**
 * Extracts message objects from session entries.
 *
 * @param entries - The session entries to filter
 * @returns The messages contained in the entries
 */
function messageEntries(entries: readonly SessionEntry[]): AgentSession["messages"] {
  return entries.filter((entry) => entry.type === "message").map((entry) => entry.message);
}

/** True when two messages share the streaming identity `role + timestamp`. */
function sameMessageIdentity(
  a: { role: string; timestamp?: number },
  b: { role: string; timestamp?: number },
): boolean {
  return a.role === b.role && a.timestamp === b.timestamp;
}
