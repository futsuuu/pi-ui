import type { UserMessage as Data, TextContent } from "@earendil-works/pi-ai";
import { css } from "styled-system/css";
import { flex } from "styled-system/patterns";

export type Props = Pick<Data, "role" | "content">;

const outerStyle = flex({ justify: "flex-end" });

const bubbleStyle = css({
  borderRadius: "xl",
  paddingInline: "4",
  paddingBlock: "3",
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  maxWidth: "agentMessage.maxWidth.user",
  backgroundColor: "card.bg",
  color: "primary.fg",
  borderWidth: "1px",
  borderColor: "border",
});

export function UserMessage({ content }: Props) {
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  if (!text.trim()) return null;

  return (
    <div className={outerStyle}>
      <div className={bubbleStyle}>{text.trim()}</div>
    </div>
  );
}
