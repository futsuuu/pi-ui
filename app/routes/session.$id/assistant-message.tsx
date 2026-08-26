import type { AssistantMessage as Data, TextContent, ThinkingContent } from "@earendil-works/pi-ai";
import { CircleSlashIcon, CircleXIcon } from "lucide-react";
import { css } from "styled-system/css";

import { Markdown } from "~/components/markdown";

import { StreamingCursor } from "./streaming-cursor";

export interface Props extends Pick<Data, "role" | "content" | "errorMessage"> {
  stopReason?: Data["stopReason"];
}

const outerStyle = css({ display: "flex", justifyContent: "flex-start" });

const bodyStyle = css({
  borderRadius: "xl",
  paddingBlock: "3",
  width: "full",
  color: "fg.primary",
});

const summaryStyle = css({
  textStyle: "xs",
  color: "warning",
  cursor: "pointer",
  userSelect: "none",
  _hover: { color: { base: "amber.700", _dark: "amber.300" } },
});

const thinkingStyle = css({
  marginTop: "1",
  padding: "2",
  backgroundColor: { base: "amber.50", _dark: "amber.900/20" },
  borderRadius: "sm",
  textStyle: "xs",
  color: { base: "amber.800", _dark: "amber.200" },
  whiteSpace: "pre-wrap",
});

const errorStyle = css({
  marginTop: "2",
  padding: "2",
  borderRadius: "sm",
  textStyle: "sm",
  color: { base: "red.700", _dark: "red.400" },
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
});

const iconStyle = css({ width: "4", height: "4", flexShrink: 0 });

const monoMutedStyle = `${css({ opacity: 0.8 })} font-mono`;

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
    <div className={outerStyle}>
      <div className={bodyStyle}>
        {thinking && (
          <details className={css({ marginBottom: "2" })}>
            <summary className={summaryStyle}>Thinking</summary>
            <div className={thinkingStyle}>{thinking}</div>
          </details>
        )}
        {(text || isStreaming) && (
          <div className={css({ overflowWrap: "break-word" })}>
            <Markdown>{text}</Markdown>
            {!text && isStreaming && "..."}
            {isStreaming && <StreamingCursor />}
          </div>
        )}

        {/* Error display */}
        {(isError || errorMessage) && (
          <div className={errorStyle}>
            <div
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "1.5",
                fontWeight: "medium",
                marginBottom: "1",
              })}
            >
              {stopReason === "aborted" && <CircleSlashIcon className={iconStyle} />}
              {stopReason !== "aborted" && <CircleXIcon className={iconStyle} />}
              <span>
                {stopReason === "aborted" ? "Aborted" : stopReason === "error" ? "Error" : "Error"}
              </span>
            </div>
            {errorMessage && <p className={monoMutedStyle}>{errorMessage}</p>}
            {stopReason && !errorMessage && (
              <p className={monoMutedStyle}>stopReason: {stopReason}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
