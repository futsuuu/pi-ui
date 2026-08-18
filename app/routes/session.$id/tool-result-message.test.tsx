import type { TextContent, ToolResultMessage as Data } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { PathDisplayProvider } from "./path-display-context";
import { ToolCallContext, type ToolCallEntry } from "./tool-call-context";
import { ToolResultMessage } from "./tool-result-message";

type Screen = Awaited<ReturnType<typeof render>>;

const CWD = "/home/user/project";
const HOME = "/home/user";

function renderToolResult(toolName: string, args: unknown, text: string) {
  const toolCallId = "call-1";
  const toolCalls = new Map<string, ToolCallEntry>([
    [toolCallId, { toolName, args: args as ToolCallEntry["args"] }],
  ]);
  const content: TextContent[] = [{ type: "text", text }];
  const props: Pick<Data, "role" | "content" | "toolName" | "toolCallId" | "isError"> = {
    role: "toolResult",
    toolCallId,
    toolName,
    content,
    isError: false,
  };
  return render(
    <PathDisplayProvider value={{ cwd: CWD, home: HOME }}>
      <ToolCallContext value={toolCalls}>
        <ToolResultMessage {...props} />
      </ToolCallContext>
    </PathDisplayProvider>,
  );
}

/** The <summary> header text (tool name + abbreviated summary). */
function summaryText(screen: Screen): string {
  return screen.container.querySelector("summary")?.textContent ?? "";
}

describe("ToolResultMessage", () => {
  it("abbreviates a read path in the summary", async () => {
    const screen = await renderToolResult("read", { path: "/home/user/project/src/a.ts" }, "body");

    expect(summaryText(screen)).toContain("src/a.ts");
    expect(summaryText(screen)).not.toContain("/home/user/project");
  });

  it("keeps the full path as the hover title", async () => {
    const screen = await renderToolResult("read", { path: "/home/user/project/src/a.ts" }, "body");

    const titled = screen.container.querySelector("summary span[title]");
    expect(titled?.getAttribute("title")).toBe("/home/user/project/src/a.ts");
    expect(summaryText(screen)).toContain("src/a.ts");
  });

  it("abbreviates a bash cd prefix in the summary", async () => {
    const screen = await renderToolResult(
      "bash",
      { command: "cd /home/user/project && git status" },
      "clean",
    );

    expect(summaryText(screen)).toContain("git status");
    expect(summaryText(screen)).not.toContain("cd /home/user/project");
  });

  it("shortens path and command fields in the args JSON", async () => {
    const screen = await renderToolResult("bash", { command: "cd /home/user/other && ls" }, "out");

    await expect.element(screen.getByText('"command"')).toBeInTheDocument();
    expect(screen.container.textContent).toContain("cd ~/other && ls");
    expect(screen.container.textContent).not.toContain("/home/user/other");
  });
});
