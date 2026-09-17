import { statSync } from "node:fs";

import type { TextContent } from "@earendil-works/pi-ai/compat";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type ModelRuntime,
  type SessionEntry,
  type SessionInfo as PersistedSessionInfo,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

import { messageKey, orderedDisplayKeys, toolResultKey } from "./routes/session.$id/message-key";
import { SdkSessionRepository } from "./sdk-session-repository";
import { SessionEventHub, type SessionEventProjection } from "./session-event-hub";
import type { SessionInfo } from "./session-info";
import {
  SessionViewStateRepository,
  type SessionReadState,
  type SessionViewState,
} from "./session-view-state";

export type ContainerEvent =
  | AgentSessionEvent
  | { type: "session_deleted" }
  | { type: "view_state"; viewState: SessionReadState };

/** Stable empty buffer shared by idle sessions (no current turn in flight). */
const EMPTY_TURN_EVENTS: AgentSessionEvent[] = [];
const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

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

/**
 * The conversation snapshot for a loaded session: the persisted leaf-path
 * entries merged with the runtime's live list. `buildContextEntries()` can
 * return a failed assistant message that auto-retry already pruned from
 * agent state, which `session.messages` alone would drop from the snapshot.
 */
export function mergedSessionMessages(session: {
  readonly messages: AgentSession["messages"];
  readonly sessionManager: Pick<SessionManager, "buildContextEntries">;
}): AgentSession["messages"] {
  const live = session.messages;
  const context = session.sessionManager.buildContextEntries();
  if (context.length === 0) return live;
  const identityOf = (message: AgentSession["messages"][number]): string | null => {
    if (message.role === "toolResult") return toolResultKey(message.toolCallId);
    if (typeof message.timestamp === "number") {
      return messageKey(message.role, message.timestamp);
    }
    // Non-conversation entries (custom, compaction summaries) have no
    // timestamp; dedupe by role. The chat renders none, so over-deduplication
    // is harmless.
    return message.role;
  };
  const seen = new Set<string>();
  const merged: AgentSession["messages"] = [];
  for (const entry of context) {
    if (entry.type !== "message") continue;
    const identity = identityOf(entry.message);
    if (identity !== null && seen.has(identity)) continue;
    if (identity !== null) seen.add(identity);
    merged.push(entry.message);
  }
  for (const message of live) {
    const identity = identityOf(message);
    if (identity !== null && seen.has(identity)) continue;
    if (identity !== null) seen.add(identity);
    merged.push(message);
  }
  // Keep the live reference only when every element is the corresponding
  // live element, so revalidation comparisons can detect snapshot changes.
  return merged.length === live.length && merged.every((message, index) => message === live[index])
    ? live
    : merged;
}

interface ActiveSessionRecord {
  runtime: Promise<AgentSessionRuntime | null>;
  turn: SessionEventProjection<AgentSessionEvent, AgentSessionEvent[]>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export class AgentSessionContainer {
  private readonly activeSessions = new Map<string, ActiveSessionRecord>();
  private readonly events = new SessionEventHub<ContainerEvent>();

  private constructor(
    private createRuntimeFactory: CreateAgentSessionRuntimeFactory,
    private viewStateRepository: SessionViewStateRepository,
    private repository: SdkSessionRepository,
  ) {}

  public listInfo(dir: string) {
    return this.repository.listInfo(dir);
  }

  /**
   * The working directory recorded for a session, or `null` when no session
   * with this ID exists. Uses the loaded runtime when present and reads the
   * persisted headers otherwise; never loads a runtime.
   */
  public async findSessionCwd(sessionId: string): Promise<string | null> {
    const record = this.activeSessions.get(sessionId);
    if (record) {
      this.refreshIdleDisposal(sessionId);
      const loaded = await record.runtime.catch(() => null);
      if (loaded) return loaded.session.sessionManager.getCwd();
    }
    return this.repository.findSessionCwd(sessionId);
  }

  public subscribe(callback: (sessionId: string, event: ContainerEvent) => void): () => void {
    return this.events.subscribe(callback);
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
    return this.activeSessions.get(sessionId)?.turn.current ?? EMPTY_TURN_EVENTS;
  }

  private handleSessionEvent(sessionId: string, event: AgentSessionEvent) {
    const record = this.activeSessions.get(sessionId);
    if (record) {
      this.refreshIdleDisposal(sessionId);
      record.turn.update(event);
    }
    if (
      (event.type === "message_end" || event.type === "tool_execution_end") &&
      this.viewStateRepository.get(sessionId) === null
    ) {
      this.viewStateRepository.set(sessionId, null);
    }
    this.events.publish(sessionId, event);
  }

  public static async create(
    modelRuntime: ModelRuntime,
    viewStateRepository: SessionViewStateRepository = new SessionViewStateRepository(),
    repository: SdkSessionRepository = new SdkSessionRepository(modelRuntime),
  ) {
    return new AgentSessionContainer(
      async ({ cwd, sessionManager, sessionStartEvent }) => {
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
      },
      viewStateRepository,
      repository,
    );
  }

  /**
   * Build a container with a custom runtime factory. Production uses
   * {@link create}; this is exposed for tests that want to avoid the real
   * model runtime and resource discovery.
   */
  public static withFactory(
    factory: CreateAgentSessionRuntimeFactory,
    viewStateRepository: SessionViewStateRepository = new SessionViewStateRepository(),
    repository: SdkSessionRepository = new SdkSessionRepository(),
  ): AgentSessionContainer {
    return new AgentSessionContainer(factory, viewStateRepository, repository);
  }

  public async create(cwd: string) {
    const sessionManager = this.repository.create(cwd);
    const runtime = await createAgentSessionRuntime(this.createRuntimeFactory, {
      cwd: sessionManager.getCwd(),
      agentDir: getAgentDir(),
      sessionManager,
    });
    const sessionId = runtime.session.sessionId;
    const record: ActiveSessionRecord = {
      runtime: Promise.resolve(runtime),
      turn: this.events.createProjection(applyTurnEvent),
    };
    this.activeSessions.set(sessionId, record);
    this.scheduleIdleDisposal(sessionId, record);
    runtime.session.subscribe((event) => this.handleSessionEvent(sessionId, event));
    return runtime.session;
  }

  public async get(sessionId: string, hints: { cwd?: string } = {}) {
    const runtime = await this.getRuntime(sessionId, hints);
    return runtime ? runtime.session : null;
  }

  private getRuntime(sessionId: string, hints: { cwd?: string } = {}) {
    const existing = this.activeSessions.get(sessionId);
    if (existing) {
      this.refreshIdleDisposal(sessionId);
      return existing.runtime;
    }
    const runtime = this.getRuntimeInner(sessionId, hints);
    const record: ActiveSessionRecord = {
      runtime,
      turn: this.events.createProjection(applyTurnEvent),
    };
    this.activeSessions.set(sessionId, record);
    void runtime.then(
      (loaded) => {
        if (this.activeSessions.get(sessionId) !== record) return;
        if (loaded) {
          this.scheduleIdleDisposal(sessionId, record);
        } else {
          this.activeSessions.delete(sessionId);
          this.clearIdleDisposal(record);
        }
      },
      () => {
        if (this.activeSessions.get(sessionId) === record) {
          this.activeSessions.delete(sessionId);
          this.clearIdleDisposal(record);
        }
      },
    );
    return runtime;
  }

  private async getRuntimeInner(sessionId: string, hints: { cwd?: string } = {}) {
    const found = await this.repository.findInfo(sessionId, hints);
    if (!found) return null;
    const sessionManager = this.repository.open(found.path);
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
    const persisted = await this.repository.listAll();
    return Promise.all(persisted.map((info) => this.infoFromPersisted(info)));
  }

  private async infoFromPersisted(persisted: PersistedSessionInfo): Promise<SessionInfo> {
    const record = this.activeSessions.get(persisted.id);
    if (record) {
      const loaded = await record.runtime.catch(() => null);
      if (loaded) return this.loadedInfo(persisted.id, loaded.session);
    }
    const keys = orderedDisplayKeys(
      messageEntries(this.repository.open(persisted.path).getEntries()),
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
      contextUsage: null,
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
    const record = this.activeSessions.get(sessionId);
    if (!record) return null;
    this.refreshIdleDisposal(sessionId);
    const loaded = await record.runtime.catch(() => null);
    return loaded ? this.loadedInfo(sessionId, loaded.session) : null;
  }

  private loadedInfo(sessionId: string, session: AgentSession): SessionInfo {
    const keys = orderedDisplayKeys(
      mergedSessionMessages(session),
      this.activeSessions.get(sessionId)?.turn.current ?? [],
    );
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

  private refreshIdleDisposal(sessionId: string) {
    const record = this.activeSessions.get(sessionId);
    if (record) this.scheduleIdleDisposal(sessionId, record);
  }

  private clearIdleDisposal(record: ActiveSessionRecord) {
    if (record.idleTimer !== undefined) clearTimeout(record.idleTimer);
    record.idleTimer = undefined;
  }

  private scheduleIdleDisposal(sessionId: string, record: ActiveSessionRecord) {
    this.clearIdleDisposal(record);
    const timer = setTimeout(() => {
      if (record.idleTimer !== timer) return;
      record.idleTimer = undefined;
      void this.disposeIfIdle(sessionId, record).catch(() => undefined);
    }, SESSION_IDLE_TIMEOUT_MS);
    timer.unref?.();
    record.idleTimer = timer;
  }

  private async disposeIfIdle(sessionId: string, record: ActiveSessionRecord) {
    if (this.activeSessions.get(sessionId) !== record || record.idleTimer !== undefined) return;
    const runtime = await record.runtime;
    if (this.activeSessions.get(sessionId) !== record || record.idleTimer !== undefined) return;
    if (runtime?.session.isStreaming || runtime?.session.isCompacting || record.turn.current) {
      this.scheduleIdleDisposal(sessionId, record);
      return;
    }
    await this.dispose(sessionId);
  }

  public async dispose(sessionId: string) {
    const record = this.activeSessions.get(sessionId);
    if (!record) return;
    this.clearIdleDisposal(record);
    this.activeSessions.delete(sessionId);
    record.turn.clear();
    const runtime = await record.runtime;
    if (runtime) await runtime.dispose();
  }

  public async disposeAll() {
    await Promise.allSettled(
      [...this.activeSessions.keys()].map((sessionId) => this.dispose(sessionId)),
    );
    this.events.clear();
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
    const found = await this.repository.findInfo(sessionId, hints);
    if (!found) throw new Error(`Session ${JSON.stringify(sessionId)} not found`);
    await this.dispose(sessionId);
    await this.repository.deletePath(found.path);
    this.viewStateRepository.delete(sessionId);
    this.events.publish(sessionId, { type: "session_deleted" });
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
    this.events.publish(sessionId, { type: "view_state", viewState: readState });
    return readState;
  }

  private async resolveOrderedKeys(
    sessionId: string,
    hints: { cwd?: string; sessionDir?: string },
  ): Promise<string[] | null> {
    const record = this.activeSessions.get(sessionId);
    if (record) {
      this.refreshIdleDisposal(sessionId);
      const loaded = await record.runtime.catch(() => null);
      if (loaded) {
        return orderedDisplayKeys(mergedSessionMessages(loaded.session), record.turn.current ?? []);
      }
    }
    const found = await this.repository.findInfo(sessionId, hints);
    if (!found) return null;
    return orderedDisplayKeys(messageEntries(this.repository.open(found.path).getEntries()));
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
    contextUsage: session.getContextUsage() ?? null,
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
