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

export function toolResultKey(toolCallId: string): string {
  return `toolResult:${toolCallId}`;
}

/**
 * Text of a user message the way UserMessage renders it: the string form or
 * text parts joined with a newline. Empty text renders nothing, so empty
 * user messages are not display items.
 */
function userDisplayText(content: UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function assistantRenderable(message: AssistantMessage): boolean {
  const text = message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  const thinking = message.content
    .filter(
      (block): block is Extract<typeof block, { type: "thinking" }> => block.type === "thinking",
    )
    .map((block) => block.thinking)
    .join("")
    .trim();
  const isError =
    message.stopReason === "error" || message.stopReason === "aborted" || !!message.errorMessage;
  return !!text || !!thinking || isError || message.stopReason === undefined;
}

/**
 * The display key of a persisted message, or null when the message cannot
 * become a read anchor: it renders nothing (empty user messages, empty
 * finalized assistant messages) or is still streaming (no `message_end` yet,
 * so its content is not final).
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
 * The display key of a chat entry, or null when it renders nothing or its
 * identity is not (yet) stable. Entries without a timestamp get no key: the
 * optimistic pending user message is one example — its timestamp only exists
 * once the session assigns one, so tracking it would flip the key.
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
  const content = (entry.content ?? []) as AssistantMessage["content"];
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
  const isError = stopReason === "error" || stopReason === "aborted" || !!entry.errorMessage;
  if (!text && !thinking && !isError) return null;
  return messageKey("assistant", entry.timestamp);
}

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
 * Fold the current turn's events into ordered display entries, coalescing by
 * identity exactly like the chat reducer: message updates replace the newest
 * entry per `role + timestamp`, tool updates per `toolCallId`. The order is
 * the event order, which matches the rendered conversation order.
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
 * The ordered, renderable display keys of a conversation: persisted messages
 * first, then settled messages from the turn buffer (deduplicated by
 * identity). Mirrors the client's rendered message order.
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
