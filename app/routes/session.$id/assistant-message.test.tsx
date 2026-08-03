import type { AssistantMessage as Data } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { AssistantMessage } from "./assistant-message";

type Screen = Awaited<ReturnType<typeof render>>;

function message(content: Data["content"], stopReason?: Data["stopReason"]) {
  return {
    role: "assistant" as const,
    content,
    stopReason,
  };
}

/** Wait for `text` to render, then assert it is wrapped in the given tag. */
async function expectTag(screen: Screen, text: string, tag: string) {
  await expect.element(screen.getByText(text, { exact: true })).toHaveTextContent(text);
  expect(screen.getByText(text, { exact: true }).element().tagName).toBe(tag);
}

describe("AssistantMessage", () => {
  it("renders assistant text as markdown", async () => {
    const screen = await render(
      <AssistantMessage {...message([{ type: "text", text: "**bold** and `code`" }], "stop")} />,
    );

    await expectTag(screen, "bold", "STRONG");
    await expectTag(screen, "code", "CODE");
  });

  it("renders GFM in assistant messages", async () => {
    const screen = await render(
      <AssistantMessage
        {...message(
          [{ type: "text", text: "- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |" }],
          "stop",
        )}
      />,
    );

    await expect.element(screen.getByRole("checkbox")).toBeChecked();
    await expect.element(screen.getByRole("table")).toBeInTheDocument();
  });

  it("still renders markdown while streaming", async () => {
    const screen = await render(
      <AssistantMessage
        {...message([{ type: "text", text: "```ts\nconst x: number = 1;\n```" }], undefined)}
      />,
    );

    // Markdown is rendered even during streaming (stopReason is undefined).
    await expect.poll(() => screen.container.querySelector("pre.shiki")).not.toBeNull();
    // Streaming cursor is shown.
    await expect.element(screen.getByText("█", { exact: true })).toBeInTheDocument();
  });

  it("shows the streaming cursor for empty streaming messages", async () => {
    const screen = await render(<AssistantMessage {...message([], undefined)} />);

    await expect.element(screen.getByText("█", { exact: true })).toBeInTheDocument();
  });

  it("renders the thinking block", async () => {
    const screen = await render(
      <AssistantMessage
        {...message(
          [
            { type: "thinking", thinking: "plan the answer" },
            { type: "text", text: "answer" },
          ],
          "stop",
        )}
      />,
    );

    await expect.element(screen.getByText("Thinking", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("plan the answer", { exact: true })).toBeInTheDocument();
    await expectTag(screen, "answer", "P");
  });

  it("renders the error message", async () => {
    const m = message([], "error");
    const screen = await render(<AssistantMessage {...m} errorMessage="something went wrong" />);

    await expect.element(screen.getByText("Error", { exact: true })).toBeInTheDocument();
    await expect
      .element(screen.getByText("something went wrong", { exact: true }))
      .toBeInTheDocument();
  });

  it("renders null for empty completed messages", async () => {
    const screen = await render(<AssistantMessage {...message([], "stop")} />);

    expect(screen.container).toBeEmptyDOMElement();
  });
});
