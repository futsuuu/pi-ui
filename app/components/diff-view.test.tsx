import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { DiffView, parseDiff } from "./diff-view";

describe("parseDiff", () => {
  it("parses context/remove/add rows with line numbers", () => {
    expect(parseDiff(" 1 const a = 1;\n-2 const b = 2;\n+2 const b = 3;", "numbered")).toEqual([
      { kind: "context", oldLine: 1, newLine: 1, content: "const a = 1;" },
      { kind: "remove", oldLine: 2, content: "const b = 2;" },
      { kind: "add", newLine: 2, content: "const b = 3;" },
    ]);
  });

  it("parses ellipsis rows used for skipped unchanged ranges", () => {
    expect(parseDiff("   ...\n 9 end", "numbered")).toEqual([
      { kind: "ellipsis" },
      { kind: "context", oldLine: 9, newLine: 9, content: "end" },
    ]);
  });

  it("keeps unmatched lines as plain rows", () => {
    expect(parseDiff("--- a/foo.ts\n 1 x", "numbered")).toEqual([
      { kind: "plain", content: "--- a/foo.ts" },
      { kind: "context", oldLine: 1, newLine: 1, content: "x" },
    ]);
  });

  it("parses unified-format rows without line numbers", () => {
    expect(parseDiff("-const a = 1;\n+const a = 2;\n context", "unified")).toEqual([
      { kind: "remove", content: "const a = 1;" },
      { kind: "add", content: "const a = 2;" },
      { kind: "context", content: "context" },
    ]);
  });

  it("keeps unified-format headers as plain rows", () => {
    expect(
      parseDiff("--- a/foo.ts\n+++ b/foo.ts\n@@ -1,2 +1,2 @@\n-const a = 1;", "unified"),
    ).toEqual([
      { kind: "plain", content: "--- a/foo.ts" },
      { kind: "plain", content: "+++ b/foo.ts" },
      { kind: "plain", content: "@@ -1,2 +1,2 @@" },
      { kind: "remove", content: "const a = 1;" },
    ]);
  });

  it("parses a numbered row with its line number", () => {
    expect(parseDiff("+2 x", "numbered")).toEqual([{ kind: "add", newLine: 2, content: "x" }]);
  });

  it("parses the same row as a unified addition without a number", () => {
    // The format is explicit, so `+2 x` is an addition whose content starts
    // with a digit, not a numbered row (no guessing needed).
    expect(parseDiff("+2 x", "unified")).toEqual([{ kind: "add", content: "2 x" }]);
  });

  it("keeps ellipsis-like rows as plain in the unified format", () => {
    // A bare `...` row is ambiguous with spread syntax in code, so unified
    // parsing keeps it as plain content instead of an omission marker.
    expect(parseDiff("...\n-const a = 1;", "unified")).toEqual([
      { kind: "plain", content: "..." },
      { kind: "remove", content: "const a = 1;" },
    ]);
  });
});

describe("DiffView", () => {
  it("renders gutter line numbers and per-row signs", async () => {
    const screen = await render(
      <DiffView
        path="foo.ts"
        format="numbered"
        diff={" 1 const a = 1;\n-2 const b = 2;\n+2 const b = 3;"}
      />,
    );

    // Wait for the commit (rendering can be deferred past `render()` resolve).
    await expect.poll(() => screen.container.querySelectorAll("tbody tr").length).toBe(3);
    const rows = screen.container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    // Row backgrounds mark removals (red) and additions (green).
    expect(rows[1].className).toContain("bg-red-50");
    expect(rows[2].className).toContain("bg-green-50");

    // Gutters: old | new — context shows both, remove only old, add only new.
    const tds = screen.container.querySelectorAll("td");
    expect(tds[0].textContent).toBe("1");
    expect(tds[1].textContent).toBe("1");
    expect(tds[3].textContent).toBe("2");
    expect(tds[4].textContent).toBe("");
    expect(tds[6].textContent).toBe("");
    expect(tds[7].textContent).toBe("2");

    // Content cells carry the sign prefix plus the line content.
    expect(tds[2].textContent).toBe(" const a = 1;");
    expect(tds[5].textContent).toBe("-const b = 2;");
    expect(tds[8].textContent).toBe("+const b = 3;");
  });

  it("defaults to the unified format", async () => {
    // No `format` prop: rows are parsed as unified, so `+2 ...` is an
    // addition whose content starts with a digit — no gutter number, the
    // leading "2 " stays in the content cell.
    const screen = await render(<DiffView lang="typescript" diff={"+2 const n: number = 2;"} />);

    await expect.poll(() => screen.container.querySelector(".diff-view")).not.toBeNull();
    const rows = screen.container.querySelectorAll(".diff-view tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector("td:nth-child(1)")?.textContent).toBe("");
    expect(rows[0].querySelector("td:nth-child(2)")?.textContent).toBe("");
    expect(rows[0].textContent).toContain("2 const n: number = 2;");
  });

  it("renders ellipsis rows for skipped unchanged ranges", async () => {
    const screen = await render(
      <DiffView path="foo.ts" format="numbered" diff={"   ...\n+5 const x = 5;"} />,
    );

    await expect.element(screen.getByText("…", { exact: true })).toBeInTheDocument();
    expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("syntax-highlights lines in the file's language", async () => {
    const screen = await render(
      <DiffView path="foo.ts" format="numbered" diff={" 1 const n: number = 1;"} />,
    );

    // Tokenization is async (Shiki lazily loads the grammar); wait for it.
    await expect.poll(() => screen.container.querySelector("span.diff-token")).not.toBeNull();
    const token = screen.container.querySelector("span.diff-token")!;
    // Dual-theme CSS variables are emitted inline on each token.
    expect(token.getAttribute("style")).toMatch(/--shiki-light/);
    expect(token.getAttribute("style")).toMatch(/--shiki-dark/);
    // The whole line is still present after highlighting.
    expect(token.closest("tr")?.textContent).toContain("const n: number = 1;");
  });

  it("tokenizes the whole block so multi-line constructs keep their syntax", async () => {
    // A template literal spanning diff rows: `  inner` is only recognized as
    // string content when the grammar state flows across lines (per-line
    // tokenization would render it as a plain identifier).
    const screen = await render(
      <DiffView
        lang="typescript"
        format="numbered"
        diff={' 1 const s = `\n+2   inner\n 3 `;\n 4 const a = "str";'}
      />,
    );

    await expect
      .poll(() => screen.container.querySelectorAll("span.diff-token").length)
      .toBeGreaterThan(0);
    const rows = screen.container.querySelectorAll("tbody tr");
    const innerToken = [...rows[1].querySelectorAll(".diff-token")].find(
      (el) => el.textContent === "  inner",
    );
    const strToken = [...rows[3].querySelectorAll(".diff-token")].find(
      (el) => el.textContent === '"str"',
    );
    expect(innerToken).not.toBeNull();
    expect(strToken).not.toBeNull();
    // Both are string tokens: the template-literal line carries the same
    // dual-theme color as a single-line string literal.
    expect(innerToken!.getAttribute("style")).toBe(strToken!.getAttribute("style"));
  });

  it("keeps multi-line comments highlighted across diff rows", async () => {
    // A block comment spanning rows: rows 0-2 are all comment tokens, row 3
    // is real code again. Per-line tokenization would render row 1
    // (`const a = 1;`) as code; the block stream keeps it inside the comment.
    const screen = await render(
      <DiffView
        path="foo.ts"
        format="numbered"
        diff={" 1 /* comment start\n 2 const a = 1;\n 3 comment end */\n 4 const b: number = 2;"}
      />,
    );

    await expect
      .poll(() => screen.container.querySelectorAll("span.diff-token").length)
      .toBeGreaterThan(0);
    const rows = screen.container.querySelectorAll("tbody tr");
    const commentStyle = rows[0].querySelector(".diff-token")!.getAttribute("style");
    // The row inside the comment keeps the comment color ...
    expect(rows[1].querySelector(".diff-token")!.getAttribute("style")).toBe(commentStyle);
    expect(rows[2].querySelector(".diff-token")!.getAttribute("style")).toBe(commentStyle);
    // ... and the row after the closing */ is tokenized as code again.
    const codeToken = [...rows[3].querySelectorAll(".diff-token")].find((el) =>
      el.textContent?.startsWith("const"),
    )!;
    expect(codeToken.getAttribute("style")).not.toBe(commentStyle);
  });

  it("resets highlighting at omissions so code after a skip is not misread", async () => {
    // A comment opens in row 0, then rows 1-2 are skipped (ellipsis). The
    // skipped lines' content is unknown, so the run after the omission
    // starts fresh: row 3 is highlighted as code, not as comment content.
    const screen = await render(
      <DiffView
        path="foo.ts"
        format="numbered"
        diff={" 1 /* comment start\n   ...\n 3 const b: number = 2;"}
      />,
    );

    await expect
      .poll(() => screen.container.querySelectorAll("span.diff-token").length)
      .toBeGreaterThan(0);
    const rows = screen.container.querySelectorAll("tbody tr");
    const codeToken = [...rows[2].querySelectorAll(".diff-token")].find((el) =>
      el.textContent?.startsWith("const"),
    )!;
    const commentToken = rows[0].querySelector(".diff-token")!;
    // The post-omission run is not inside the comment anymore.
    expect(codeToken.getAttribute("style")).not.toBe(commentToken.getAttribute("style"));
  });

  it("lets an explicit lang override an unknown file extension", async () => {
    const screen = await render(
      <DiffView
        path="file.xyz"
        lang="typescript"
        format="numbered"
        diff={"+1 const n: number = 1;"}
      />,
    );

    await expect.poll(() => screen.container.querySelector("span.diff-token")).not.toBeNull();
    expect(screen.container.querySelector("span.diff-token")?.getAttribute("style")).toMatch(
      /--shiki-light/,
    );
  });

  it("paints the container background with the Shiki theme and caps the height", async () => {
    const screen = await render(
      <DiffView path="foo.ts" format="numbered" diff={" 1 const a = 1;"} />,
    );

    await expect
      .poll(() => screen.container.querySelector(".diff-view")?.getAttribute("style"))
      .toMatch(/--shiki-light-bg/);
    const container = screen.container.querySelector(".diff-view")!;
    // Dual-theme background variables are emitted inline, matching pre.shiki.
    expect(container.getAttribute("style")).toMatch(/--shiki-light-bg:/);
    expect(container.getAttribute("style")).toMatch(/--shiki-dark-bg:/);
    // Tall diffs scroll within a fixed-height panel.
    expect(container.className).toContain("max-h-80");
    expect(container.className).toContain("overflow-auto");
  });

  it("keeps add/remove row tints visible through token spans", async () => {
    const screen = await render(
      <DiffView path="foo.ts" format="numbered" diff={"-1 const a = 1;\n+1 const a = 2;"} />,
    );

    // Both rows get tokenized once the grammar loads.
    await expect
      .poll(() => screen.container.querySelectorAll("span.diff-token").length)
      .toBeGreaterThan(0);
    const token = screen.container.querySelector("span.diff-token")!;
    // Token spans must not paint an opaque theme background over the row
    // background (add rows are green, remove rows are red).
    expect(getComputedStyle(token).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // The remove row still carries its red tint.
    const rows = screen.container.querySelectorAll("tbody tr");
    expect(rows[0].className).toContain("bg-red-50");
    expect(rows[1].className).toContain("bg-green-50");
  });

  it("renders plain text for unknown languages", async () => {
    const screen = await render(<DiffView path="file.xyz" format="numbered" diff={"+1 hello"} />);

    await expect.element(screen.getByText("hello", { exact: true })).toBeInTheDocument();
    // No grammar is known for .xyz: no token spans, plain text only.
    expect(screen.container.querySelector("span.diff-token")).toBeNull();
  });
});
