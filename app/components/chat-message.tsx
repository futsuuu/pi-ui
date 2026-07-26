import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent, ThinkingContent } from "@earendil-works/pi-ai";
import { Check, Wrench, X } from "lucide-react";

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage | SystemMessage;

export type UserMessage = {
  id: string;
  role: "user";
  content: string;
};

export type AssistantMessage = {
  id: string;
  role: "assistant";
  content: string;
  thinking?: string;
  isStreaming?: boolean;
};

export type ToolMessage = {
  id: string;
  role: "tool";
  content: string;
  toolName: string;
  toolArgs?: unknown;
  isError?: boolean;
  isStreaming?: boolean;
};

export type SystemMessage = {
  id: string;
  role: "system";
  content: string;
};

/** Extract a short summary of tool args for inline display */
function toChatMessage(msg: AgentMessage, index: number): ChatMessage {
  const id = `msg-${index}-${msg.timestamp}`;

  if (msg.role === "user") {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((b): b is TextContent => b.type === "text")
            .map((b) => b.text)
            .join("\n");
    return { id, role: "user", content };
  }

  if (msg.role === "assistant") {
    const content = msg.content
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const thinking =
      msg.content
        .filter((b): b is ThinkingContent => b.type === "thinking")
        .map((b) => b.thinking)
        .join("\n") || undefined;
    return { id, role: "assistant", content, thinking };
  }

  if (msg.role === "toolResult") {
    const content = msg.content
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return {
      id: msg.toolCallId,
      role: "tool",
      content,
      toolName: msg.toolName,
      isError: msg.isError,
    };
  }

  // Fallback for unknown/custom message types
  return { id, role: "system", content: "" };
}

/** Convert AgentMessage[] to ChatMessage[], resolving tool calls from assistant messages. */
export function toChatMessages(msgs: AgentMessage[]): ChatMessage[] {
  // First pass: extract tool call arguments from assistant messages
  const toolCallMap = new Map<string, { toolName: string; args: unknown }>();
  for (const msg of msgs) {
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "toolCall") {
          toolCallMap.set(block.id, { toolName: block.name, args: block.arguments });
        }
      }
    }
  }

  // Second pass: convert messages, injecting args for tool results
  return msgs.map((msg, i) => {
    const cm = toChatMessage(msg, i);
    if (msg.role === "toolResult" && cm.role === "tool") {
      const tc = toolCallMap.get(msg.toolCallId);
      if (tc) {
        cm.toolArgs = tc.args;
        cm.toolName = tc.toolName;
      }
    }
    return cm;
  });
}

/** Animated cursor shown while streaming */
function StreamingCursor() {
  return <span className="inline-block w-2 h-4 bg-blue-500 dark:bg-blue-400 ml-1 animate-pulse" />;
}

function UserMessageEntry({ msg }: { msg: UserMessage }) {
  return (
    <div className="flex justify-end">
      <div className="rounded-xl px-4 py-3 whitespace-pre-wrap break-words max-w-[80%] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700">
        {msg.content.trim()}
      </div>
    </div>
  );
}

function ToolMessageEntry({ msg }: { msg: ToolMessage }) {
  let summary: string | undefined;
  if (msg.toolArgs != null && typeof msg.toolArgs === "object") {
    const record = msg.toolArgs as Record<string, unknown>;
    switch (msg.toolName) {
      case "read":
      case "write":
      case "edit": {
        const path = record.path;
        if (typeof path === "string") summary = path;
        break;
      }
      case "bash": {
        const command = record.command;
        if (typeof command === "string") summary = command;
        break;
      }
      case "rg":
      case "grep": {
        const pattern = record.pattern;
        if (typeof pattern === "string") summary = pattern;
        break;
      }
    }
  }
  return (
    <div className="flex justify-start">
      <div className="rounded-xl py-3 w-full text-gray-700 dark:text-gray-300 font-mono text-sm border border-gray-200 dark:border-gray-700 px-4">
        {msg.toolName && (
          <details className="group" open={msg.isStreaming || undefined}>
            <summary className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden [&::marker]:hidden">
              <Wrench className="w-3 h-3 shrink-0 text-gray-400" />
              <span className="font-medium shrink-0 text-gray-400">{msg.toolName}</span>
              {summary ? (
                <span className="truncate text-gray-600 dark:text-gray-300" title={summary}>
                  {summary}
                </span>
              ) : null}
              {msg.isError !== undefined &&
                (msg.isError ? (
                  <X className="ml-auto w-4 h-4 text-red-500 dark:text-red-400 shrink-0" />
                ) : (
                  <Check className="ml-auto w-4 h-4 text-green-500 dark:text-green-400 shrink-0" />
                ))}
            </summary>
            <div className="mt-2 space-y-2">
              {msg.toolArgs != null && (
                <pre className="p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs text-gray-500 dark:text-gray-200 overflow-x-auto max-h-48 whitespace-pre">
                  {JSON.stringify(msg.toolArgs, null, 2)}
                </pre>
              )}
              <div className="overflow-x-auto whitespace-pre">
                {msg.content || (msg.isStreaming ? "..." : "")}
                {msg.isStreaming && <StreamingCursor />}
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function AssistantMessageEntry({ msg }: { msg: AssistantMessage }) {
  const thinking = msg.thinking?.trim();
  const content = msg.content.trim();
  if (!thinking && !content && !msg.isStreaming) return null;
  return (
    <div className="flex justify-start">
      <div className="rounded-xl py-3 w-full text-gray-900 dark:text-gray-100">
        {thinking && (
          <details className="mb-2">
            <summary className="text-xs text-amber-600 dark:text-amber-400 cursor-pointer hover:text-amber-700 dark:hover:text-amber-300 select-none">
              Thinking
            </summary>
            <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
              {msg.thinking}
            </div>
          </details>
        )}
        {(content || msg.isStreaming) && (
          <div className="whitespace-pre-wrap break-words">
            {content || (msg.isStreaming ? "..." : "")}
            {msg.isStreaming && <StreamingCursor />}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemMessageEntry({ msg }: { msg: SystemMessage }) {
  const content = msg.content.trim();
  if (!content) return null;
  return (
    <div className="flex justify-start">
      <div className="rounded-xl py-3 w-full text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
        {content}
      </div>
    </div>
  );
}

export function MessageEntry({ msg }: { msg: ChatMessage }) {
  switch (msg.role) {
    case "user":
      return <UserMessageEntry msg={msg} />;
    case "tool":
      return <ToolMessageEntry msg={msg} />;
    case "assistant":
      return <AssistantMessageEntry msg={msg} />;
    case "system":
      return <SystemMessageEntry msg={msg} />;
  }
}
