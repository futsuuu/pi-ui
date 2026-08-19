import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

/**
 * The shared identity of a displayed message, stable across streaming
 * (`message_start` / `message_update` / `message_end`), persistence, and
 * loader revalidation:
 *
 * - user / assistant messages: `role + timestamp` (the provider creates the
 *   partial once with its timestamp and mutates it in place, so every
 *   streamed copy and the persisted final message carry the same value).
 * - tool results: `toolResult:<toolCallId>` (entries carry no timestamp).
 *
 * This identity is used both by the chat reducer and by the server-side
 * display cursor, so the two can never disagree about which message a key
 * refers to.
 */
export function messageKey(role: string, timestamp: number | undefined): string {
  return `${role}:${timestamp ?? ""}`;
}

/**
 * Creates a stable display key for a tool result.
 *
 * @param toolCallId - The identifier of the tool call associated with the result
 * @returns A display key derived from the tool call identifier
 */
export function toolResultKey(toolCallId: string): string {
  return `toolResult:${toolCallId}`;
}

/**
 * Converts user message content to the text displayed in the conversation.
 *
 * @param content - The user message content.
 * @returns The text content, with separate text blocks joined by newlines.
 */
function userDisplayText(content: UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Determines whether an assistant message has displayable text, thinking content, or an error state.
 *
 * @returns `true` if the message contains trimmed text or thinking content, or represents an error or abort; `false` otherwise.
 */
function assistantContentPresent(message: {
  content: unknown;
  stopReason?: AssistantMessage["stopReason"];
  errorMessage?: string;
}): boolean {
  const content = (message.content ?? []) as AssistantMessage["content"];
  const text = content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  const thinking = content
    .filter(
      (block): block is Extract<typeof block, { type: "thinking" }> => block.type === "thinking",
    )
    .map((block) => block.thinking)
    .join("")
    .trim();
  const isError =
    message.stopReason === "error" || message.stopReason === "aborted" || !!message.errorMessage;
  return !!text || !!thinking || isError;
}

/**
 * Determines whether an assistant message should be rendered.
 *
 * @returns `true` if the message has content or no stop reason, `false` otherwise.
 */
function assistantRenderable(message: AssistantMessage): boolean {
  return assistantContentPresent(message) || message.stopReason === undefined;
}

/**
 * Determines the display key for a persisted user, assistant, or tool-result message.
 *
 * @returns The message key when the message has displayable finalized content, or `null` otherwise.
 */
export function messageKeyOf(message: AgentMessage): string | null {
  switch (message.role) {
    case "user":
      return userDisplayText(message.content).trim() ? messageKey("user", message.timestamp) : null;
    case "assistant":
      if (message.stopReason === undefined) return null; // in-flight partial
      return assistantRenderable(message) ? messageKey("assistant", message.timestamp) : null;
    case "toolResult":
      return toolResultKey(message.toolCallId);
    default:
      return null;
  }
}

/** A chat entry (`eventMessages` / `pendingUserMessage`) whose key is derivable. */
export type DisplayEntry = {
  role: string;
  content?: unknown;
  timestamp?: number;
  toolCallId?: string;
  stopReason?: string;
  errorMessage?: string;
  isStreaming?: boolean;
};

/**
 * Determines the stable display key for a chat entry.
 *
 * @param entry - The chat entry whose display identity is evaluated
 * @returns The entry's display key, or `null` when it has no stable display identity
 */
export function entryKeyOf(entry: DisplayEntry): string | null {
  if (entry.role === "toolResult") {
    // A running tool shows a placeholder, but its result is not final until
    // tool_execution_end clears isStreaming.
    return entry.toolCallId && !entry.isStreaming ? toolResultKey(entry.toolCallId) : null;
  }
  if (entry.role !== "user" && entry.role !== "assistant") return null;
  if (entry.timestamp === undefined) return null;
  if (entry.role === "user") {
    return userDisplayText((entry.content ?? "") as UserMessage["content"]).trim()
      ? messageKey("user", entry.timestamp)
      : null;
  }
  // The reducer strips the placeholder stopReason from in-flight partials, so
  // an undefined stopReason means the entry is still streaming: it cannot
  // become a read anchor until message_end settles it.
  const stopReason = entry.stopReason as AssistantMessage["stopReason"] | undefined;
  if (stopReason === undefined) return null;
  return assistantContentPresent({
    content: entry.content,
    stopReason,
    errorMessage: entry.errorMessage,
  })
    ? messageKey("assistant", entry.timestamp)
    : null;
}

/**
 * Determines whether a message and display entry represent the same message identity.
 *
 * @param message - The message to compare.
 * @param entry - The display entry to compare.
 * @returns `true` if both values identify the same tool result or share the same role and timestamp, `false` otherwise.
 */
export function sameIdentity(
  message: AgentMessage,
  entry: { role: string; timestamp?: number; toolCallId?: string },
): boolean {
  if (message.role === "toolResult" && entry.role === "toolResult") {
    return message.toolCallId === entry.toolCallId;
  }
  return messageKey(message.role, message.timestamp) === messageKey(entry.role, entry.timestamp);
}

/** One display entry folded from the turn buffer (current turn only). */
export interface TurnDisplayEntry {
  /** Identity used to coalesce updates (`role:timestamp` or `toolResult:toolCallId`). */
  identity: string;
  /** Display key, or null while the entry renders nothing (finalized empty). */
  key: string | null;
}

/**
 * Folds current-turn events into ordered display entries grouped by message or tool identity.
 *
 * In-flight assistant messages and running tools have a `null` display key until finalized.
 *
 * @param events - The current turn's session events in conversation order
 * @returns Coalesced display entries in event order
 */
export function foldTurnEvents(events: readonly AgentSessionEvent[]): TurnDisplayEntry[] {
  const entries: TurnDisplayEntry[] = [];
  for (const event of events) {
    switch (event.type) {
      case "message_start":
      case "message_update":
      case "message_end": {
        const message = event.message;
        if (message.role === "toolResult") {
          upsertDisplayEntry(
            entries,
            toolResultKey(message.toolCallId),
            toolResultKey(message.toolCallId),
          );
        } else if (message.role === "user" || message.role === "assistant") {
          const identity = messageKey(message.role, message.timestamp);
          // Only message_end settles a read anchor: an in-flight assistant
          // partial (message_start/message_update) is rendered but its
          // content is not final yet, so it cannot advance the cursor.
          const key =
            message.role === "assistant" && event.type !== "message_end"
              ? null
              : messageKeyOf(message);
          upsertDisplayEntry(entries, identity, key);
        }
        break;
      }
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end": {
        const identity = toolResultKey(event.toolCallId);
        // The result is not final while the tool is running: only
        // tool_execution_end (or the toolResult message events after it)
        // settles the read anchor.
        const key = event.type === "tool_execution_end" ? identity : null;
        upsertDisplayEntry(entries, identity, key);
        break;
      }
    }
  }
  return entries;
}

/**
 * Inserts a display entry or replaces the existing entry with the same identity.
 *
 * @param entries - The display entries to update
 * @param identity - The stable identity of the entry
 * @param key - The display key, or `null` when the entry is not yet settled
 */
function upsertDisplayEntry(
  entries: TurnDisplayEntry[],
  identity: string,
  key: string | null,
): void {
  const index = entries.findIndex((entry) => entry.identity === identity);
  if (index === -1) entries.push({ identity, key });
  else entries[index] = { identity, key };
}

/**
 * Produces deduplicated display keys in conversation order, combining persisted messages with settled turn entries.
 *
 * @returns The ordered display keys for renderable messages and turn entries.
 */
export function orderedDisplayKeys(
  messages: readonly AgentMessage[],
  turnEvents: readonly AgentSessionEvent[] = [],
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string | null) => {
    if (key != null && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  for (const message of messages) push(messageKeyOf(message));
  for (const entry of foldTurnEvents(turnEvents)) push(entry.key);
  return keys;
}
