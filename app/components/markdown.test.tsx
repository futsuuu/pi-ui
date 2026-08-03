import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { Markdown } from "./markdown";

type Screen = Awaited<ReturnType<typeof render>>;

/** Wait for `text` to render, then assert it is wrapped in the given tag. */
async function expectTag(screen: Screen, text: string, tag: string) {
  await expect.element(screen.getByText(text, { exact: true })).toHaveTextContent(text);
  expect(screen.getByText(text, { exact: true }).element().tagName).toBe(tag);
}

describe("Markdown", () => {
  it("renders headings, paragraphs, and inline emphasis", async () => {
    const screen = await render(<Markdown>{"# Title\n\nHello **world** and *italics*"}</Markdown>);

    await expect
      .element(screen.getByRole("heading", { level: 1, name: "Title" }))
      .toBeInTheDocument();
    await expectTag(screen, "world", "STRONG");
    await expectTag(screen, "italics", "EM");
  });

  it("renders lists", async () => {
    const screen = await render(<Markdown>{"- one\n- two\n\n1. first\n2. second"}</Markdown>);

    await expect.poll(() => screen.container.querySelectorAll("ul, ol").length).toBe(2);
    expect(screen.container.querySelectorAll("li").length).toBe(4);
  });

  it("renders GFM tables", async () => {
    const screen = await render(<Markdown>{"| name | value |\n|---|---|\n| a | 1 |"}</Markdown>);

    await expect.element(screen.getByRole("table")).toBeInTheDocument();
    await expect.poll(() => screen.container.querySelectorAll("th").length).toBe(2);
    const ths = screen.container.querySelectorAll("th");
    expect(ths[0]).toHaveTextContent("name");
    expect(ths[1]).toHaveTextContent("value");
    expect(screen.container.querySelector("tbody td:last-child")).toHaveTextContent("1");
  });

  it("wraps tables in a horizontal scroll container", async () => {
    const screen = await render(<Markdown>{"| a | b |\n|---|---|\n| 1 | 2 |"}</Markdown>);

    await expect.element(screen.getByRole("table")).toBeInTheDocument();
    const wrapper = screen.getByRole("table").element().parentElement;
    // Wide tables scroll within the message instead of widening the screen.
    expect(wrapper?.className).toContain("overflow-x-auto");
  });

  it("renders GFM task lists with checkbox state", async () => {
    const screen = await render(<Markdown>{"- [x] done\n- [ ] todo"}</Markdown>);

    await expect
      .poll(() => screen.container.querySelectorAll('input[type="checkbox"]').length)
      .toBe(2);
    const boxes = screen.container.querySelectorAll('input[type="checkbox"]');
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
  });

  it("renders GFM strikethrough and autolinks", async () => {
    const screen = await render(<Markdown>{"~~gone~~ and https://example.com"}</Markdown>);

    await expectTag(screen, "gone", "DEL");
    const auto = screen.getByRole("link", { name: "https://example.com", exact: true });
    await expect.element(auto).toHaveAttribute("href", "https://example.com");
  });

  it("opens links in a new tab with noreferrer", async () => {
    const screen = await render(<Markdown>{"[docs](https://example.com/docs)"}</Markdown>);

    const link = screen.getByRole("link", { name: "docs" });
    await expect.element(link).toHaveAttribute("href", "https://example.com/docs");
    await expect.element(link).toHaveAttribute("target", "_blank");
    await expect.element(link).toHaveAttribute("rel", "noreferrer");
  });

  it("disables unsafe URL protocols", async () => {
    const screen = await render(<Markdown>{"[x](javascript:alert(1))"}</Markdown>);

    await expect.element(screen.getByText("x", { exact: true })).toBeInTheDocument();
    // The anchor renders with an empty href (the unsafe protocol is stripped), so
    // it is not exposed with the link role in accessibility APIs.
    const link = screen.getByText("x", { exact: true }).element().closest("a");
    expect(link).not.toBeNull();
    // Only asserting that removal is effective (the scheme is gone from the href);
    // we are deliberately not asserting a full URL-sanitization policy here.
    expect(link).not.toHaveAttribute("href", "javascript:alert(1)");
  });

  it("renders inline code", async () => {
    const screen = await render(<Markdown>{"run `pnpm test`"}</Markdown>);

    await expectTag(screen, "pnpm test", "CODE");
  });

  it("keeps the parent's weight for bold-wrapped inline code", async () => {
    const screen = await render(<Markdown>{"**`bold`** and `plain`"}</Markdown>);

    const bold = screen.getByText("bold", { exact: true });
    const plain = screen.getByText("plain", { exact: true });
    await expect.element(bold).toHaveTextContent("bold");
    await expect.element(plain).toHaveTextContent("plain");

    const boldEl = bold.element();
    const plainEl = plain.element();
    const boldW = parseInt(getComputedStyle(boldEl).fontWeight);
    const parentW = parseInt(getComputedStyle(boldEl.parentElement!).fontWeight);
    const plainW = parseInt(getComputedStyle(plainEl).fontWeight);

    expect(boldEl.tagName).toBe("CODE");
    expect(boldEl.parentElement?.tagName).toBe("STRONG");
    expect(boldW).toBe(parentW);
    expect(boldW).toBeGreaterThan(plainW);
  });

  it("renders fenced code blocks with Shiki highlighting", async () => {
    const screen = await render(<Markdown>{"```ts\nconst n: number = 1;\n```"}</Markdown>);

    await expect.poll(() => screen.container.querySelector("pre.shiki")).not.toBeNull();
    const pre = screen.container.querySelector("pre.shiki")!;
    expect(pre.querySelector("code")?.textContent).toBe("const n: number = 1;");
    expect(pre.querySelector("code")).toHaveClass("language-ts");
    // Shiki tokenizes the code into spans.
    expect(pre.querySelector("span")).not.toBeNull();
    // Dual-theme CSS variables are emitted on the <pre> element.
    expect(pre.getAttribute("style")).toMatch(/--shiki-light/);
    expect(pre.getAttribute("style")).toMatch(/--shiki-dark/);
  });

  it("lazily loads an unbundled language and highlights its tokens", async () => {
    const screen = await render(<Markdown>{"```haskell\nmain :: IO a -> a\n```"}</Markdown>);

    // No grammar is preloaded (langs: []). With `lazy: true` shiki loads
    // "haskell" by dynamically importing its @shikijs/langs chunk, which Vite
    // bundles with the app (it is not fetched from a remote CDN).
    await expect
      .poll(() => screen.container.querySelector("pre.shiki code.language-haskell"))
      .not.toBeNull();
    const code = screen.container.querySelector("pre.shiki code.language-haskell")!;
    expect(code.textContent).toBe("main :: IO a -> a");
    // Syntax highlighting actually tokenized the code: vs. the plain-text
    // fallback (which renders no colored spans), here the grammar produced
    // token spans carrying dual-theme --shiki-* color variables.
    expect(code.querySelector('span[style*="--shiki-"]')).not.toBeNull();
  });

  it("falls back to plain text for unknown languages", async () => {
    const screen = await render(<Markdown>{"```not-a-real-lang\nhello\n```"}</Markdown>);

    await expect.poll(() => screen.container.querySelector("pre.shiki")).not.toBeNull();
    expect(screen.container.querySelector("pre.shiki code")?.textContent).toBe("hello");
  });

  it("renders code fences without a language via Shiki for a consistent background", async () => {
    const screen = await render(<Markdown>{"```\nplain\n```"}</Markdown>);

    // A fence with no language is treated as plain text through Shiki, so it
    // gets the same themed background as other code blocks.
    await expect.poll(() => screen.container.querySelector("pre.shiki")).not.toBeNull();
    expect(screen.container.querySelector("pre.shiki code")?.textContent).toBe("plain");
  });

  it("escapes raw HTML instead of executing it", async () => {
    const screen = await render(<Markdown>{"<script>alert('x')</script>"}</Markdown>);

    await expect
      .element(screen.getByText("<script>alert('x')</script>", { exact: true }))
      .toBeInTheDocument();
    // Scoped to the component's container: the test harness injects its own
    // <script> tags into <body>.
    expect(screen.container.querySelector("script")).toBeNull();
  });
});
