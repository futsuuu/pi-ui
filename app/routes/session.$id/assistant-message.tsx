import type { AssistantMessage as Data, TextContent, ThinkingContent } from "@earendil-works/pi-ai";
import { CircleSlashIcon, CircleXIcon } from "lucide-react";

import { StreamingCursor } from "./streaming-cursor";

export interface Props extends Pick<Data, "role" | "content" | "errorMessage"> {
  stopReason?: Data["stopReason"];
}

export function AssistantMessage({ content, stopReason, errorMessage }: Props) {
  const text = content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const thinking =
    content
      .filter((b): b is ThinkingContent => b.type === "thinking")
      .map((b) => b.thinking)
      .join("")
      .trim() || undefined;
  const isError = stopReason === "error" || stopReason === "aborted" || !!errorMessage;
  const isStreaming = stopReason === undefined;
  if (!thinking && !text && !isError && !isStreaming) return null;
  return (
    <div className="flex justify-start">
      <div className="rounded-xl py-3 w-full text-gray-900 dark:text-gray-100">
        {thinking && (
          <details className="mb-2">
            <summary className="text-xs text-amber-600 dark:text-amber-400 cursor-pointer hover:text-amber-700 dark:hover:text-amber-300 select-none">
              Thinking
            </summary>
            <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
              {thinking}
            </div>
          </details>
        )}
        {(text || isStreaming) && (
          <div className="whitespace-pre-wrap break-words">
            {text || (isStreaming ? "..." : "")}
            {isStreaming && <StreamingCursor />}
          </div>
        )}

        {/* Error display */}
        {(isError || errorMessage) && (
          <div className="mt-2 p-2 rounded text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap break-words">
            <div className="flex items-center gap-1.5 font-medium mb-1">
              {stopReason === "aborted" && <CircleSlashIcon className="w-4 h-4 shrink-0" />}
              {stopReason !== "aborted" && <CircleXIcon className="w-4 h-4 shrink-0" />}
              <span>
                {stopReason === "aborted" ? "Aborted" : stopReason === "error" ? "Error" : "Error"}
              </span>
            </div>
            {errorMessage && <p className="font-mono opacity-80">{errorMessage}</p>}
            {stopReason && !errorMessage && (
              <p className="font-mono opacity-80">stopReason: {stopReason}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
