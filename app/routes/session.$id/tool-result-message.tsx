import type { ToolResultMessage as Data, TextContent } from "@earendil-works/pi-ai";
import type { EditToolDetails } from "@earendil-works/pi-coding-agent";
import { CheckIcon, Loader2Icon, WrenchIcon, XIcon } from "lucide-react";
import { css } from "styled-system/css";

import { DiffView } from "~/components/diff-view";
import { ScrollArea } from "~/components/scroll-area";
import { displayBashCommand, displayPath, displayToolArgs } from "~/path-display";

import { usePathDisplay } from "./path-display-context";
import { useToolCall } from "./tool-call-context";

export type Props = Pick<Data, "role" | "content" | "toolName" | "toolCallId" | "isError"> & {
  /** Tool-specific result metadata (the edit tool's display diff etc.). */
  details?: EditToolDetails;
  isStreaming?: boolean;
};

const outerStyle = css({ display: "flex", justifyContent: "flex-start" });

const panelStyle = css({
  borderRadius: "xl",
  paddingBlock: "3",
  width: "full",
  color: "fg.secondary",
  textStyle: "sm",
  borderWidth: "1px",
  borderColor: "border",
  paddingInline: "4",
});

const summaryStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  color: "fg.secondary",
  cursor: "pointer",
  userSelect: "none",
  listStyleType: "none",
  "&::-webkit-details-marker": { display: "none" },
  "&::marker": { display: "none" },
});

const summaryTextStyle = css({
  fontFamily: "mono",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "fg.secondary",
});

const argsStyle = css({
  padding: "2",
  backgroundColor: "bg.subtle",
  borderRadius: "sm",
  textStyle: "xs",
  color: "fg.muted",
});

const resultViewportClass = `${css({ whiteSpace: "pre" })} font-mono`;

export function ToolResultMessage({
  content,
  toolName,
  toolCallId,
  isError,
  isStreaming,
  details,
}: Props) {
  const toolCall = useToolCall(toolCallId ?? "");
  const { cwd, home } = usePathDisplay();

  const text = content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let summary: string | undefined;
  // Raw values behind a shortened summary, kept for the hover title so the
  // full path/command stays reachable when the display form is shortened.
  let summaryFull: string | undefined;
  const record =
    toolCall?.args != null && typeof toolCall.args === "object"
      ? (toolCall.args as Record<string, unknown>)
      : undefined;
  if (record) {
    switch (toolName) {
      case "read":
      case "write":
      case "edit": {
        const path = record.path;
        if (typeof path === "string") {
          summary = displayPath(path, cwd, home);
          summaryFull = path;
        }
        break;
      }
      case "bash": {
        const command = record.command;
        if (typeof command === "string") {
          summary = displayBashCommand(command, cwd, home);
          summaryFull = command;
        }
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

  // The edit tool renders its display diff instead of the plain-text summary;
  // everything else keeps the args JSON + result text.
  const diff = toolName === "edit" ? details?.diff : undefined;

  return (
    <div className={outerStyle}>
      <div className={panelStyle}>
        {toolName && (
          <details open={diff ? true : isStreaming || undefined}>
            <summary className={summaryStyle}>
              <WrenchIcon
                className={css({ width: "3", height: "3", flexShrink: 0, color: "fg.subtle" })}
              />
              <span className={css({ fontWeight: "medium", flexShrink: 0, color: "fg.subtle" })}>
                {toolName}
              </span>
              {summary ? (
                <span className={summaryTextStyle} title={summaryFull ?? summary}>
                  {summary}
                </span>
              ) : null}
              {isStreaming ? (
                <Loader2Icon
                  className={css({
                    marginLeft: "auto",
                    width: "4",
                    height: "4",
                    color: "fg.subtle",
                    flexShrink: 0,
                    animation: "spin",
                  })}
                />
              ) : isError !== undefined ? (
                isError ? (
                  <XIcon
                    className={css({
                      marginLeft: "auto",
                      width: "4",
                      height: "4",
                      color: "danger.icon",
                      flexShrink: 0,
                    })}
                  />
                ) : (
                  <CheckIcon
                    className={css({
                      marginLeft: "auto",
                      width: "4",
                      height: "4",
                      color: "success.icon",
                      flexShrink: 0,
                    })}
                  />
                )
              ) : null}
            </summary>
            <div
              className={css({
                marginTop: "2",
                "& > :not([hidden]) ~ :not([hidden])": { marginTop: "2" },
              })}
            >
              {diff ? (
                <DiffView path={summary} diff={diff} format="numbered" />
              ) : (
                <>
                  {record && (
                    <ScrollArea className={argsStyle} viewportClassName={resultViewportClass}>
                      {JSON.stringify(displayToolArgs(record, cwd, home), null, 2)}
                    </ScrollArea>
                  )}
                  <ScrollArea viewportClassName={resultViewportClass}>{text}</ScrollArea>
                </>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
