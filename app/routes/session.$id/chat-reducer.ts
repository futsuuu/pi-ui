import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, StopReason } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { Props as AgentMessageProps } from "./agent-message";
import { buildToolCallMap, type ToolCallMap } from "./tool-call-context";

export type AgentMessagePropsWithKey = AgentMessageProps & { _key: string };

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
}

/**
 * Create the chat state for the given loader messages (session history).
 * Pass this to `useReducer` as the initializer:
 * `useReducer(chatReducer, loadedMessages, createChatState)`.
 */
export function createChatState(loadedMessages: AgentMessage[]): ChatState {
  return {
    loadedMessages,
    eventMessages: [],
    toolCallMap: buildToolCallMap(loadedMessages),
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
  | { type: "reset"; loadedMessages: AgentMessage[] };

/**
 * Reducer for the session chat UI, compatible with `React.useReducer`.
 *
 * It folds `ChatAction`s into the chat state that the Chat route renders on
 * top of the loader data:
 *
 * ```ts
 * const [chat, dispatch] = useReducer(chatReducer, loadedMessages, createChatState);
 * dispatch(event); // per SSE event
 * ```
 *
 * Event ordering (see the agent loop in `@earendil-works/pi-agent-core`):
 * - A run starts with `agent_start` → `turn_start`, then `message_start` /
 *   `message_end` for the user prompt, then for each assistant message
 *   `message_start` (empty partial) → `message_update` (delta snapshots) →
 *   `message_end` (final message with content + stopReason + errorMessage).
 * - Tool calls stream as `tool_execution_start` → `tool_execution_update*` →
 *   `tool_execution_end`, followed by `message_start`/`message_end` for the
 *   toolResult message, then `turn_end`. The loop repeats with `turn_start`
 *   for further turns and finally emits `agent_end` (with the run's messages)
 *   and, once everything has settled, `agent_settled`.
 *
 * Design notes:
 * - The user's own message is held optimistically in `pendingUserMessage`;
 *   the SSE `message_start` (user) event promotes it into `eventMessages`, and
 *   every connected clients can see the same conversation.
 * - Tool result entries are created at `tool_execution_start` (so the running
 *   tool is visible immediately); the later `message_start`/`message_end` for
 *   the toolResult message must therefore not append anything.
 * - Every `message_update` carries the authoritative accumulated partial
 *   message, so the last assistant entry's content is replaced wholesale
 *   instead of appending deltas. Providers put a placeholder
 *   `stopReason: "stop"` on in-flight partials, so updates only touch the
 *   content and the entry keeps streaming (`stopReason === undefined`) until
 *   `message_end` applies the final content, stopReason and errorMessage.
 * - The reducer is pure and immutable: unhandled events return the same state
 *   reference, which lets `useReducer` bail out of re-rendering.
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
        return {
          ...state,
          eventMessages: [
            ...state.eventMessages,
            {
              _key: state.pendingUserMessage?._key ?? uid(),
              role: "user",
              content: message.content,
            },
          ],
          // The optimistic pending entry is promoted into `eventMessages`.
          pendingUserMessage: undefined,
        };
      }
      if (message.role !== "assistant") return state;
      return {
        ...state,
        eventMessages: [
          ...state.eventMessages,
          { _key: uid(), role: "assistant", content: message.content },
        ],
      };
    }
    case "message_update": {
      // The partial carries the full accumulated content, but providers put a
      // placeholder `stopReason: "stop"` on in-flight messages, so only the
      // content is applied; the entry keeps streaming until `message_end`.
      const { message } = action;
      if (message.role !== "assistant") return state;
      return updateAssistantContent(state, message.content);
    }
    case "message_end": {
      // The final message (content, stopReason, errorMessage) arrives here.
      const { message } = action;
      if (message.role !== "assistant") return state;
      return replaceLastAssistant(state, message);
    }
    case "tool_execution_start": {
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
      return updateToolResult(state, action.toolCallId, (entry) => ({
        ...entry,
        content: action.partialResult?.content ?? [],
      }));
    }
    case "tool_execution_end": {
      return updateToolResult(state, action.toolCallId, (entry) => ({
        ...entry,
        content: action.result?.content ?? [],
        isStreaming: false,
        isError: action.isError,
      }));
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

      // If the last assistant message is still streaming, finalise it with the
      // stop reason/error from the run messages (catch-all for runs that ended
      // without a message_end).
      if (eventMessages.length > 0) {
        const last = eventMessages[eventMessages.length - 1];
        if (last?.role === "assistant" && last.stopReason === undefined) {
          eventMessages = [
            ...eventMessages.slice(0, -1),
            {
              _key: last._key,
              role: "assistant",
              content: last.content,
              stopReason,
              ...(errorMessage ? { errorMessage } : {}),
            },
          ];
          changed = true;
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
      // Loader revalidation or a session switch: replace the loader-derived
      // messages and rebuild the toolCallMap from them (so a stale map from
      // another session can never leak through). SSE-derived event messages
      // are dropped — they are now included in the loader data.
      return {
        loadedMessages: action.loadedMessages,
        eventMessages: [],
        toolCallMap: buildToolCallMap(action.loadedMessages),
        pendingUserMessage: undefined,
      };
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

/** Replace the last assistant message with the given final/partial message. */
function replaceLastAssistant(state: ChatState, message: AssistantMessage): ChatState {
  const last = state.eventMessages[state.eventMessages.length - 1];
  if (last?.role !== "assistant") return state;
  return {
    ...state,
    eventMessages: [
      ...state.eventMessages.slice(0, -1),
      { _key: last._key, ...assistantEntry(message) },
    ],
  };
}

/**
 * Apply the accumulated partial content to the last assistant message without
 * touching its stopReason, so the entry keeps streaming until `message_end`.
 *
 * TODO: the installed @earendil-works/pi-* packages (0.81.1) put a
 * placeholder `stopReason: "stop"` on in-flight partials, so only the content
 * is applied here. If a newer version uses `"pending"` as the in-flight
 * sentinel instead, re-add the `"pending"` → `undefined` normalization in
 * `assistantEntry` (message_update can then replace the whole entry again)
 * and update the test fixtures from "stop" to "pending" for partials.
 */
function updateAssistantContent(state: ChatState, content: AssistantMessage["content"]): ChatState {
  const last = state.eventMessages[state.eventMessages.length - 1];
  if (last?.role !== "assistant") return state;
  return {
    ...state,
    eventMessages: [...state.eventMessages.slice(0, -1), { ...last, content }],
  };
}

/** Apply an update to the tool result message with the given toolCallId. */
function updateToolResult(
  state: ChatState,
  toolCallId: string,
  update: (
    entry: Extract<AgentMessagePropsWithKey, { role: "toolResult" }>,
  ) => AgentMessagePropsWithKey,
): ChatState {
  const idx = findToolIndex(state.eventMessages, toolCallId);
  if (idx === -1) return state;
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
