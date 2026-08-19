import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, StopReason } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { Props as AgentMessageProps } from "./agent-message";
import { entryKeyOf, messageKey, messageKeyOf, sameIdentity } from "./message-key";
import { buildToolCallMap, type ToolCallMap } from "./tool-call-context";

export type AgentMessagePropsWithKey = AgentMessageProps & {
  _key: string;
  /**
   * Streaming identity: the underlying message timestamp, stable across
   * `message_start` / `message_update` / `message_end` and persistence.
   */
  timestamp?: number;
};

export interface ChatState {
  /** Session history from the loader, rendered as-is (keyed by index). */
  loadedMessages: AgentMessage[];
  /**
   * Messages streamed via SSE that are not yet included in the loader data;
   * promoted into `loadedMessages` on the next loader revalidation.
   */
  eventMessages: AgentMessagePropsWithKey[];
  toolCallMap: ToolCallMap;
  /**
   * The user's own message shown optimistically at the end of the message
   * area, until the SSE `message_start` (user) event promotes it into
   * `eventMessages`.
   */
  pendingUserMessage?: AgentMessagePropsWithKey;
  /** Session this state belongs to; `reset` clears events on a session change. */
  sessionId: string | null;
}

/**
 * Create the chat state for the given loader messages (session history).
 * Pass this to `useReducer` as the initializer:
 * `useReducer(chatReducer, loadedMessages, createChatState)`.
 */
export function createChatState(
  loadedMessages: AgentMessage[],
  sessionId: string | null = null,
): ChatState {
  return {
    loadedMessages,
    eventMessages: [],
    toolCallMap: buildToolCallMap(loadedMessages),
    sessionId,
  };
}

/**
 * Actions the chat UI dispatches: `AgentSessionEvent`s as forwarded by the SSE
 * loader, plus the UI-only actions `user_message` (optimistic pending entry),
 * `abort`, and `reset` (loader revalidation / session switch).
 */
export type ChatAction =
  | AgentSessionEvent
  | { type: "user_message"; content: string }
  | { type: "abort" }
  | {
      type: "reset";
      loadedMessages: AgentMessage[];
      /** The session's in-flight turn events from the loader (optional). */
      turnEvents?: readonly AgentSessionEvent[];
      sessionId: string | null;
    };

/**
 * Reduces chat actions into immutable session state for the chat UI.
 *
 * Handles streamed assistant and tool messages, optimistic user messages,
 * lifecycle events, session resets, and aborted runs. Unchanged or unsupported
 * actions return the existing state reference.
 *
 * @param state - The current chat session state
 * @param action - The chat event or state-management action to apply
 * @returns The updated chat session state
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "message_start": {
      // The user's own prompt arrives as an SSE event here (the agent loop
      // emits it when the run starts), so every connected tab appends it and
      // sees the same conversation; there is no optimistic pre-append.
      // toolResult entries are created at `tool_execution_start`; custom/other
      // roles are not rendered by this chat UI. Only assistant messages need a
      // placeholder here (empty for streamed responses, pre-filled when the
      // provider returns the message without streaming deltas).
      const { message } = action;
      if (message.role === "user") {
        const pending = state.pendingUserMessage;
        // The same start event can arrive both from the loader's turn buffer
        // (a revalidation seed) and from the live stream (when the loader
        // response races the SSE delivery): append only once by identity.
        const identity = messageKey("user", pending?.timestamp ?? message.timestamp);
        if (state.eventMessages.some((m) => m.role === "user" && entryIdentity(m) === identity)) {
          return { ...state, pendingUserMessage: undefined };
        }
        return {
          ...state,
          eventMessages: [
            ...state.eventMessages,
            {
              _key: pending?._key ?? uid(),
              role: "user",
              content: message.content,
              timestamp: pending?.timestamp ?? message.timestamp,
            },
          ],
          // The optimistic pending entry is promoted into `eventMessages`.
          pendingUserMessage: undefined,
        };
      }
      if (message.role !== "assistant") return state;
      // Same double-append guard: a duplicate placeholder would render an
      // empty assistant entry that later updates (matched by identity) never
      // see.
      const identity = messageKey("assistant", message.timestamp);
      if (
        state.eventMessages.some((m) => m.role === "assistant" && entryIdentity(m) === identity)
      ) {
        return state;
      }
      return {
        ...state,
        eventMessages: [
          ...state.eventMessages,
          {
            _key: uid(),
            role: "assistant",
            content: message.content,
            timestamp: message.timestamp,
          },
        ],
      };
    }
    case "message_update": {
      // The partial carries the full accumulated content, but providers put a
      // placeholder `stopReason: "stop"` on in-flight messages, so only the
      // content is applied; the entry keeps streaming until `message_end`.
      const { message } = action;
      if (message.role !== "assistant") return state;
      return updateAssistantContent(state, message);
    }
    case "message_end": {
      // The final message (content, stopReason, errorMessage) arrives here.
      const { message } = action;
      if (message.role !== "assistant") return state;
      return replaceAssistantByIdentity(state, message);
    }
    case "tool_execution_start": {
      // Double-append guard, same race as message_start: a duplicate entry
      // would break the single-entry-per-toolCallId self-healing.
      if (
        state.eventMessages.some(
          (m) => m.role === "toolResult" && m.toolCallId === action.toolCallId,
        )
      ) {
        return state;
      }
      return {
        ...state,
        eventMessages: [
          ...state.eventMessages,
          {
            _key: uid(),
            role: "toolResult",
            content: [],
            toolName: action.toolName,
            toolCallId: action.toolCallId,
            isError: false,
            isStreaming: true,
          },
        ],
        toolCallMap: new Map(state.toolCallMap).set(action.toolCallId, {
          toolName: action.toolName,
          args: action.args,
        }),
      };
    }
    case "tool_execution_update": {
      return updateToolResult(
        state,
        action,
        (entry) => ({
          ...entry,
          content: action.partialResult?.content ?? [],
        }),
        (toolName) => ({
          _key: uid(),
          role: "toolResult",
          content: action.partialResult?.content ?? [],
          toolName,
          toolCallId: action.toolCallId,
          isError: false,
          isStreaming: true,
          // args stay out of the entry: they are recorded in toolCallMap by
          // updateToolResult, mirroring tool_execution_start's entry.
        }),
      );
    }
    case "tool_execution_end": {
      return updateToolResult(
        state,
        action,
        (entry) => ({
          ...entry,
          content: action.result?.content ?? [],
          // The edit tool returns its display diff here (details.diff); the
          // chat entry carries it so ToolResultMessage can render a diff view.
          details: action.result?.details,
          isStreaming: false,
          isError: action.isError,
        }),
        (toolName) => ({
          _key: uid(),
          role: "toolResult",
          content: action.result?.content ?? [],
          toolName,
          toolCallId: action.toolCallId,
          details: action.result?.details,
          isError: action.isError,
          isStreaming: false,
        }),
      );
    }
    case "turn_end":
    case "agent_settled": {
      return closeStreamingMessages(state);
    }
    case "agent_end": {
      // Extract error info from the final messages
      let stopReason: StopReason = "stop";
      let errorMessage: string | undefined;
      if (action.messages) {
        for (let i = action.messages.length - 1; i >= 0; i--) {
          const msg = action.messages[i];
          if (msg.role === "assistant") {
            stopReason = msg.stopReason;
            errorMessage = msg.errorMessage;
            break;
          }
        }
      }

      let eventMessages = state.eventMessages;
      let changed = false;

      // If the last streaming assistant message never got a message_end,
      // finalise it with the stop reason/error from the run messages
      // (catch-all for runs that ended without a message_end).
      for (let i = eventMessages.length - 1; i >= 0; i--) {
        const last = eventMessages[i];
        if (last?.role === "assistant" && last.stopReason === undefined) {
          eventMessages = [
            ...eventMessages.slice(0, i),
            {
              // Spread the existing entry so the identity fields (timestamp
              // and _key) survive: sameIdentity matches the persisted message
              // by role+timestamp during a later reset rebuild.
              ...last,
              stopReason,
              ...(errorMessage ? { errorMessage } : {}),
            },
            ...eventMessages.slice(i + 1),
          ];
          changed = true;
          break;
        }
      }

      // Close any remaining streaming messages. Unchanged entries keep their
      // object identity, so reference comparison detects whether anything
      // changed; returning the same state lets useReducer bail out.
      const closed = eventMessages.map((m): AgentMessagePropsWithKey => {
        if (m.role === "assistant" && m.stopReason === undefined) {
          return { ...m, stopReason: "stop" };
        }
        if (m.role === "toolResult" && m.isStreaming) {
          return { ...m, isStreaming: false };
        }
        return m;
      });
      changed ||= closed.some((m, i) => m !== eventMessages[i]);

      return changed ? { ...state, eventMessages: closed } : state;
    }
    case "user_message": {
      // Hold the user's own message optimistically until the SSE
      // `message_start` (user) event promotes it into `messages`: the sending
      // tab gets immediate feedback while other tabs stay consistent.
      return {
        ...state,
        pendingUserMessage: { _key: uid(), role: "user", content: action.content },
      };
    }
    case "abort": {
      // Mark the in-flight assistant message as aborted and stop any
      // streaming tool result (immediate local feedback; the session also
      // emits a final `message_end` with stopReason "aborted").
      const eventMessages = state.eventMessages.map((m): AgentMessagePropsWithKey => {
        if (m.role === "assistant" && m.stopReason === undefined) {
          return { ...m, stopReason: "aborted" };
        }
        if (m.role === "toolResult" && m.isStreaming) {
          return { ...m, isStreaming: false };
        }
        return m;
      });
      return eventMessages.some((m, i) => m !== state.eventMessages[i])
        ? { ...state, eventMessages }
        : state;
    }
    case "reset": {
      const { loadedMessages, turnEvents = [], sessionId } = action;
      // On a session change, eventMessages are cleared first: message identity
      // is only unique within a session, and a fresh event of the new session
      // could collide with a stale (role, timestamp) from the previous one and
      // be wrongly skipped. On a revalidation, live entries not yet promoted
      // into the fresh snapshot survive; promoted ones are dropped because they
      // are now rendered from `loadedMessages`.
      const keptEvents =
        state.sessionId !== sessionId
          ? []
          : state.eventMessages.filter(
              (entry) => !loadedMessages.some((message) => sameIdentity(message, entry)),
            );
      const next: ChatState = {
        loadedMessages,
        eventMessages: keptEvents,
        toolCallMap: buildToolCallMap(loadedMessages),
        pendingUserMessage: undefined,
        sessionId,
      };
      // Rebuild: kept tool entries must keep their toolCallMap (args) so the
      // tool summary still renders while the tool is in flight.
      const toolCallMap = new Map(next.toolCallMap);
      for (const entry of keptEvents) {
        if (entry.role === "toolResult" && entry.toolCallId) {
          const prev = state.toolCallMap.get(entry.toolCallId);
          if (prev) toolCallMap.set(entry.toolCallId, prev);
        }
      }
      next.toolCallMap = toolCallMap;
      return seedTurnEvents(next, turnEvents);
    }
    case "agent_start":
    case "auto_retry_start":
    case "auto_retry_end":
    case "compaction_start":
    case "compaction_end":
    case "entry_appended":
    case "queue_update":
    case "session_info_changed":
    case "summarization_retry_scheduled":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
    case "thinking_level_changed":
    case "turn_start": {
      return state;
    }
    default: {
      action satisfies never;
      console.error("Unhandled event type:", (action as { type: string }).type);
      return state;
    }
  }
}

/**
 * Creates a stable identity key for a message entry.
 *
 * @param entry - The message entry whose role and timestamp define its identity
 * @returns The entry's identity key
 */
function entryIdentity(entry: { role: string; timestamp?: number }): string {
  return messageKey(entry.role, entry.timestamp);
}

/**
 * Builds the ordered, deduplicated display keys for the current chat state.
 *
 * @param chat - The chat state whose loaded, live, and pending messages are projected
 * @returns The display keys in render order
 */
export function chatDisplayKeys(chat: ChatState): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string | null) => {
    if (key != null && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  for (const message of chat.loadedMessages) push(messageKeyOf(message));
  for (const message of chat.eventMessages) push(entryKeyOf(message));
  push(chat.pendingUserMessage ? entryKeyOf(chat.pendingUserMessage) : null);
  return keys;
}

/** Find the index of a tool result message by its toolCallId */
function findToolIndex(messages: AgentMessagePropsWithKey[], toolCallId: string): number {
  return messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === toolCallId);
}

/**
 * Convert the final assistant message carried by `message_end`/`agent_end`
 * into the fields the chat UI renders, including the real stopReason and
 * errorMessage. In-flight partials from `message_update` are NOT mapped with
 * this helper: providers set a placeholder `stopReason: "stop"` on them, so
 * only `updateAssistantContent` is used to keep the entry streaming
 * (`stopReason === undefined`).
 */
function assistantEntry(message: AssistantMessage): {
  role: "assistant";
  content: AssistantMessage["content"];
  stopReason?: StopReason;
  errorMessage?: string;
} {
  return {
    role: message.role,
    content: message.content,
    stopReason: message.stopReason,
    ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
  };
}

/**
 * Applies an assistant message to its matching entry or appends it when no matching entry exists.
 *
 * @param message - The assistant message to apply.
 * @returns The chat state containing the updated assistant entry.
 */
function replaceAssistantByIdentity(state: ChatState, message: AssistantMessage): ChatState {
  const identity = messageKey("assistant", message.timestamp);
  const idx = state.eventMessages.findIndex(
    (m) => m.role === "assistant" && entryIdentity(m) === identity,
  );
  if (idx === -1) {
    return {
      ...state,
      eventMessages: [
        ...state.eventMessages,
        { _key: uid(), ...assistantEntry(message), timestamp: message.timestamp },
      ],
    };
  }
  const eventMessages = [...state.eventMessages];
  eventMessages[idx] = { ...eventMessages[idx], ...assistantEntry(message) };
  return { ...state, eventMessages };
}

/**
 * Updates the content of a streaming assistant message and adds it when its start event is missing.
 *
 * @param state - The current chat state
 * @param message - The assistant message containing the accumulated content
 * @returns The updated chat state with the assistant content applied
 */
function updateAssistantContent(state: ChatState, message: AssistantMessage): ChatState {
  const identity = messageKey("assistant", message.timestamp);
  const idx = state.eventMessages.findIndex(
    (m) => m.role === "assistant" && entryIdentity(m) === identity,
  );
  if (idx === -1) {
    return {
      ...state,
      eventMessages: [
        ...state.eventMessages,
        { _key: uid(), role: "assistant", content: message.content, timestamp: message.timestamp },
      ],
    };
  }
  const eventMessages = [...state.eventMessages];
  const entry = eventMessages[idx] as Extract<AgentMessagePropsWithKey, { role: "assistant" }>;
  eventMessages[idx] = { ...entry, content: message.content };
  return { ...state, eventMessages };
}

/**
 * Apply an update to the tool result message with the given toolCallId,
 * creating the entry (and its toolCallMap entry) when `tool_execution_start`
 * was lost. `args` is absent on `tool_execution_end`, so a self-healed end
 * inherits the args recorded at start (or from a previous update).
 */
function updateToolResult(
  state: ChatState,
  action: { toolCallId: string; toolName: string; args?: unknown },
  update: (
    entry: Extract<AgentMessagePropsWithKey, { role: "toolResult" }>,
  ) => AgentMessagePropsWithKey,
  create: (toolName: string, args: unknown) => AgentMessagePropsWithKey,
): ChatState {
  const idx = findToolIndex(state.eventMessages, action.toolCallId);
  if (idx === -1) {
    const args = action.args ?? state.toolCallMap.get(action.toolCallId)?.args ?? {};
    const entry = create(action.toolName, args);
    return {
      ...state,
      eventMessages: [...state.eventMessages, entry],
      toolCallMap: new Map(state.toolCallMap).set(action.toolCallId, {
        toolName: action.toolName,
        args,
      }),
    };
  }
  const eventMessages = [...state.eventMessages];
  eventMessages[idx] = update(
    eventMessages[idx] as Extract<AgentMessagePropsWithKey, { role: "toolResult" }>,
  );
  return { ...state, eventMessages };
}

/** Close unfinished assistant messages and streaming tool results. */
function closeStreamingMessages(state: ChatState): ChatState {
  const eventMessages = state.eventMessages.map((m): AgentMessagePropsWithKey => {
    if (m.role === "assistant" && m.stopReason === undefined) {
      return { ...m, stopReason: "stop" };
    }
    if (m.role === "toolResult" && m.isStreaming) {
      return { ...m, isStreaming: false };
    }
    return m;
  });
  // Unchanged entries keep their object identity, so reference comparison tells
  // whether anything was closed; returning the same state lets useReducer bail.
  return eventMessages.some((m, i) => m !== state.eventMessages[i])
    ? { ...state, eventMessages }
    : state;
}

/** Safe ID generator – works in all browsers and contexts */
function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Apply the loader's turn events to a freshly rebuilt state, skipping any
 * identity already rendered from the snapshot (`loadedMessages`) or kept as a
 * live entry from the previous state (its live content is newer than the
 * buffered event). Only `message_end` / `tool_execution_end` may finalize a
 * kept entry. Entries created while seeding are ordinary stream events and
 * are applied normally.
 */
function seedTurnEvents(state: ChatState, turnEvents: readonly AgentSessionEvent[]): ChatState {
  // Identities kept from the previous state: the live content is newer than
  // the buffered events, so updates are skipped (only ends finalize).
  const keptIdentities = new Set(
    state.eventMessages
      .filter((m) => m.role === "assistant" || m.role === "user")
      .map((m) => entryIdentity(m)),
  );
  const keptTools = new Set(
    state.eventMessages.filter((m) => m.role === "toolResult").map((m) => m.toolCallId),
  );
  let next = state;
  for (const event of turnEvents) {
    next = applySeedEvent(next, event, keptIdentities, keptTools);
  }
  return next;
}

/**
 * Applies a buffered agent event during chat-state restoration.
 *
 * @param state - The current chat state
 * @param event - The buffered event to replay
 * @param keptIdentities - Message identities retained from the live state
 * @param keptTools - Tool call IDs retained from the live state
 * @returns The updated chat state
 */
function applySeedEvent(
  state: ChatState,
  event: AgentSessionEvent,
  keptIdentities: ReadonlySet<string>,
  keptTools: ReadonlySet<string>,
): ChatState {
  if (
    event.type === "message_start" ||
    event.type === "message_update" ||
    event.type === "message_end"
  ) {
    const identity = messageKey(event.message.role, event.message.timestamp);
    if (state.loadedMessages.some((m) => messageKey(m.role, m.timestamp) === identity)) {
      // Already rendered from the snapshot.
      return state;
    }
    if (keptIdentities.has(identity)) {
      // The kept live entry is newer than the buffered event; only the final
      // event may finalize it.
      return event.type === "message_end" ? chatReducer(state, event) : state;
    }
    return chatReducer(state, event);
  }
  if (
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  ) {
    if (
      state.loadedMessages.some((m) => m.role === "toolResult" && m.toolCallId === event.toolCallId)
    ) {
      return state;
    }
    if (keptTools.has(event.toolCallId)) {
      return event.type === "tool_execution_end" ? chatReducer(state, event) : state;
    }
    return chatReducer(state, event);
  }
  return chatReducer(state, event);
}
