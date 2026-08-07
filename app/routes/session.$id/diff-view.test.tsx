import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { DiffView, parseDiff } from "./diff-view";

describe("parseDiff", () => {
  it("parses context/remove/add rows with line numbers", () => {
    expect(parseDiff(" 1 const a = 1;\n-2 const b = 2;\n+2 const b = 3;")).toEqual([
      { kind: "context", oldLine: 1, newLine: 1, content: "const a = 1;" },
      { kind: "remove", oldLine: 2, content: "const b = 2;" },
      { kind: "add", newLine: 2, content: "const b = 3;" },
    ]);
  });

  it("parses ellipsis rows used for skipped unchanged ranges", () => {
    expect(parseDiff("   ...\n 9 end")).toEqual([
      { kind: "ellipsis" },
      { kind: "context", oldLine: 9, newLine: 9, content: "end" },
    ]);
  });

  it("keeps unmatched lines as plain rows", () => {
    expect(parseDiff("--- a/foo.ts\n 1 x")).toEqual([
      { kind: "plain", content: "--- a/foo.ts" },
      { kind: "context", oldLine: 1, newLine: 1, content: "x" },
    ]);
  });
});

describe("DiffView", () => {
  it("renders gutter line numbers and per-row signs", async () => {
    const screen = await render(
      <DiffView path="foo.ts" diff={" 1 const a = 1;\n-2 const b = 2;\n+2 const b = 3;"} />,
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

  it("renders ellipsis rows for skipped unchanged ranges", async () => {
    const screen = await render(<DiffView path="foo.ts" diff={"   ...\n+5 const x = 5;"} />);

    await expect.element(screen.getByText("…", { exact: true })).toBeInTheDocument();
    expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("syntax-highlights lines in the file's language", async () => {
    const screen = await render(<DiffView path="foo.ts" diff={" 1 const n: number = 1;"} />);

    // Tokenization is async (Shiki lazily loads the grammar); wait for it.
    await expect.poll(() => screen.container.querySelector("span.diff-token")).not.toBeNull();
    const token = screen.container.querySelector("span.diff-token")!;
    // Dual-theme CSS variables are emitted inline on each token.
    expect(token.getAttribute("style")).toMatch(/--shiki-light/);
    expect(token.getAttribute("style")).toMatch(/--shiki-dark/);
    // The whole line is still present after highlighting.
    expect(token.closest("tr")?.textContent).toContain("const n: number = 1;");
  });

  it("paints the container background with the Shiki theme and caps the height", async () => {
    const screen = await render(<DiffView path="foo.ts" diff={" 1 const a = 1;"} />);

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
      <DiffView path="foo.ts" diff={"-1 const a = 1;\n+1 const a = 2;"} />,
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
    const screen = await render(<DiffView path="file.xyz" diff={"+1 hello"} />);

    await expect.element(screen.getByText("hello", { exact: true })).toBeInTheDocument();
    // No grammar is known for .xyz: no token spans, plain text only.
    expect(screen.container.querySelector("span.diff-token")).toBeNull();
  });
});
