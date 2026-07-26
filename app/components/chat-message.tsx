import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent, ThinkingContent } from "@earendil-works/pi-ai";
import { Check, Wrench, X } from "lucide-react";

// --- Types ---
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "thinking" | "system";
  content: string;
  thinking?: string;
  toolName?: string;
  toolArgs?: unknown;
  isError?: boolean;
  isStreaming?: boolean;
}

/** Extract a short summary of tool args for inline display */
export function summarizeToolArgs(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;

  switch (toolName) {
    case "read":
    case "write":
    case "edit": {
      const path = record.path;
      if (typeof path === "string") return path;
      return undefined;
    }
    case "bash": {
      const command = record.command;
      if (typeof command === "string") return command;
      return undefined;
    }
    case "rg":
    case "grep": {
      const pattern = record.pattern;
      if (typeof pattern === "string") return pattern;
      return undefined;
    }
    default:
      return undefined;
  }
}

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
    if (msg.role === "toolResult") {
      const tc = toolCallMap.get(msg.toolCallId);
      if (tc) {
        cm.toolArgs = tc.args;
        cm.toolName = tc.toolName;
      }
    }
    return cm;
  });
}

export function MessageEntry({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="rounded-xl px-4 py-3 whitespace-pre-wrap break-words max-w-[80%] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700">
          {msg.content.trim()}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className={`rounded-xl py-3 ${
          msg.role === "tool"
            ? "w-full text-gray-700 dark:text-gray-300 font-mono text-sm border border-gray-200 dark:border-gray-700 px-4"
            : "w-full text-gray-900 dark:text-gray-100"
        }`}
      >
        {msg.toolName && msg.role === "tool" && (
          <details className="group" open={msg.isStreaming || undefined}>
            <summary className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden [&::marker]:hidden">
              <Wrench className="w-3 h-3 shrink-0 text-gray-500 dark:text-gray-400" />
              <span className="font-medium shrink-0 text-gray-500 dark:text-gray-400">
                {msg.toolName}
              </span>
              {(() => {
                const summary =
                  msg.toolArgs != null ? summarizeToolArgs(msg.toolName!, msg.toolArgs) : undefined;
                return summary ? (
                  <span className="truncate text-gray-600 dark:text-gray-300" title={summary}>
                    {summary}
                  </span>
                ) : null;
              })()}
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
              {(msg.content.trim() || msg.isStreaming) && (
                <div className="overflow-x-auto whitespace-pre">
                  {msg.content.trim() || (msg.isStreaming ? "..." : "")}
                  {msg.isStreaming && (
                    <span className="inline-block w-2 h-4 bg-blue-500 dark:bg-blue-400 ml-1 animate-pulse" />
                  )}
                </div>
              )}
            </div>
          </details>
        )}
        {msg.thinking && (
          <details className="mb-2">
            <summary className="text-xs text-amber-600 dark:text-amber-400 cursor-pointer hover:text-amber-700 dark:hover:text-amber-300 select-none">
              Thinking
            </summary>
            <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
              {msg.thinking}
            </div>
          </details>
        )}
        {msg.role !== "tool" && (msg.content.trim() || msg.isStreaming) && (
          <div className="whitespace-pre-wrap break-words">
            {msg.content.trim() || (msg.isStreaming ? "..." : "")}
            {msg.isStreaming && (
              <span className="inline-block w-2 h-4 bg-blue-500 dark:bg-blue-400 ml-1 animate-pulse" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
