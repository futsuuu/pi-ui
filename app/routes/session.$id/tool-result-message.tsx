import type { ToolResultMessage as Data, TextContent } from "@earendil-works/pi-ai";
import { Check, Wrench, X } from "lucide-react";

import { StreamingCursor } from "./streaming-cursor";
import { useToolCall } from "./tool-call-context";

export type Props = Pick<Data, "role" | "content" | "toolName" | "toolCallId" | "isError"> & {
  isStreaming?: boolean;
};

export function ToolResultMessage({ content, toolName, toolCallId, isError, isStreaming }: Props) {
  const toolCall = useToolCall(toolCallId ?? "");

  const text = content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  let summary: string | undefined;
  const toolArgs = toolCall?.args;
  if (toolArgs != null && typeof toolArgs === "object") {
    const record = toolArgs as Record<string, unknown>;
    switch (toolName) {
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
      <div className="rounded-xl py-3 w-full text-gray-700 dark:text-gray-300 text-sm border border-gray-200 dark:border-gray-700 px-4">
        {toolName && (
          <details className="group" open={isStreaming || undefined}>
            <summary className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden [&::marker]:hidden">
              <Wrench className="w-3 h-3 shrink-0 text-gray-400" />
              <span className="font-medium shrink-0 text-gray-400">{toolName}</span>
              {summary ? (
                <span
                  className="font-mono truncate text-gray-600 dark:text-gray-300"
                  title={summary}
                >
                  {summary}
                </span>
              ) : null}
              {isError !== undefined &&
                (isError ? (
                  <X className="ml-auto w-4 h-4 text-red-500 dark:text-red-400 shrink-0" />
                ) : (
                  <Check className="ml-auto w-4 h-4 text-green-500 dark:text-green-400 shrink-0" />
                ))}
            </summary>
            <div className="mt-2 space-y-2">
              {toolArgs != null && (
                <pre className="p-2 bg-gray-100 dark:bg-gray-800 rounded font-mono text-xs text-gray-500 dark:text-gray-200 overflow-x-auto max-h-48 whitespace-pre">
                  {JSON.stringify(toolArgs, null, 2)}
                </pre>
              )}
              <div className="overflow-x-auto font-mono whitespace-pre">
                {text || (isStreaming ? "..." : "")}
                {isStreaming && <StreamingCursor />}
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
