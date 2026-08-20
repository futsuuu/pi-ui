import type { ThemedToken } from "shiki";

import {
  type DiffLine,
  consecutiveCodeSegments,
  diffRowStyle,
  getThemeBgVars,
  highlightSegments,
  parseDiff,
} from "./diff-view";

/**
 * Minimal HAST shapes used by the diff-fence rewrite below (the project has no
 * direct unist/hast dependency, so the tree is typed structurally).
 */
interface HText {
  type: "text";
  value: string;
}
interface HElement {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  data?: { meta?: unknown };
  children: HNode[];
}
interface HRoot {
  type: "root";
  children: HNode[];
}
type HNode = HText | HElement | HRoot;

function el(
  tagName: string,
  properties: Record<string, unknown>,
  children: HNode[] = [],
): HElement {
  return { type: "element", tagName, properties, children };
}

function text(value: string): HText {
  return { type: "text", value };
}

function isElement(node: HNode): node is HElement {
  return node.type === "element";
}

function hasLanguageClass(code: HElement, lang: string): boolean {
  const className = code.properties?.className;
  return Array.isArray(className) && className.includes(`language-${lang}`);
}

function codeText(code: HElement): string {
  return code.children
    .filter((child): child is HText => child.type === "text")
    .map((child) => child.value)
    .join("");
}

/** The inner language and body of a ```diff lang``` fence. */
function diffFence(pre: HElement): { lang: string; code: string } | undefined {
  const code = pre.children[0];
  if (!isElement(code) || code.tagName !== "code") return undefined;
  if (!hasLanguageClass(code, "diff")) return undefined;
  const meta = code.data?.meta;
  if (typeof meta !== "string" || meta.trim() === "") return undefined;
  // The first word of the info string after `diff` is the language (Shiki
  // resolves aliases like `ts` → typescript at tokenization time).
  const lang = meta.trim().split(/\s+/)[0] ?? "";
  // mdast-util-to-hast appends a trailing newline to fence bodies; drop it so
  // parseDiff does not see an empty trailing row.
  return { lang, code: codeText(code).replace(/\n$/, "") };
}

/** Serialize a style map (`--shiki-light:#…`) into a CSS declaration string. */
function styleString(style: Record<string, string | undefined> | undefined): string | undefined {
  if (!style) return undefined;
  const declarations = Object.entries(style)
    .filter((entry): entry is [string, string] => entry[1] != null)
    .map(([key, value]) => `${key}:${value}`);
  return declarations.length > 0 ? declarations.join(";") : undefined;
}

function rowElement(line: DiffLine, tokens: ThemedToken[] | undefined): HElement {
  if (line.kind === "ellipsis") {
    return el("tr", { className: "text-gray-400 dark:text-gray-600" }, [
      el("td", { colSpan: 3, className: "px-2 select-none" }, [text("\u2026")]),
    ]);
  }

  const { rowClass, sign, signClass, plainClass, oldLine, newLine } = diffRowStyle(line);
  const hasTokens = tokens !== undefined && tokens.length > 0;

  const content: HNode[] = [el("span", { className: `select-none ${signClass}` }, [text(sign)])];
  if (hasTokens) {
    for (const token of tokens) {
      const props: Record<string, unknown> = { className: "diff-token" };
      const style = styleString(token.htmlStyle);
      if (style) props.style = style;
      content.push(el("span", props, [text(token.content)]));
    }
  } else {
    content.push(el("span", plainClass ? { className: plainClass } : {}, [text(line.content)]));
  }

  return el("tr", rowClass ? { className: rowClass } : {}, [
    el("td", { className: `w-9 px-2 text-right select-none ${signClass}` }, [
      text(String(oldLine ?? "")),
    ]),
    el("td", { className: `w-9 px-2 text-right select-none ${signClass}` }, [
      text(String(newLine ?? "")),
    ]),
    el("td", { className: "pr-2 whitespace-pre" }, content),
  ]);
}

/**
 * Build the full diff-table HAST for a ```diff lang``` fence, mirroring the
 * DiffView component used for the edit tool's `details.diff` (same row
 * classes, gutters, signs, and per-segment Shiki tokenization via the shared
 * helpers in diff-view.tsx). Running at rehype time means the fence never
 * needs a custom element: react-markdown renders plain table/div/span nodes.
 */
async function diffTableElement(lang: string, code: string): Promise<HElement> {
  const lines = parseDiff(code);
  const [tokenLines, bgVars] = await Promise.all([
    highlightSegments(consecutiveCodeSegments(lines), lang),
    getThemeBgVars(),
  ]);
  const table = el(
    "table",
    { className: "w-full border-collapse font-mono text-xs leading-5 tabular-nums" },
    [
      el(
        "tbody",
        {},
        lines.map((line, i) => rowElement(line, tokenLines.get(i))),
      ),
    ],
  );
  // not-prose: the GitHub-style table is styled by DiffView/.diff-view itself
  // and must not pick up @tailwindcss/typography table rules.
  const props: Record<string, unknown> = {
    className: "diff-view not-prose rounded-lg overflow-auto max-h-80",
  };
  const style = styleString(bgVars);
  if (style) props.style = style;
  return el("div", props, [table]);
}

async function transform(node: HNode): Promise<void> {
  if (node.type !== "element" && node.type !== "root") return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!isElement(child)) continue;
    const fence = child.tagName === "pre" ? diffFence(child) : undefined;
    if (fence) {
      // The fence is terminal: replaced entirely, no recursion into it.
      node.children[i] = await diffTableElement(fence.lang, fence.code);
    } else {
      await transform(child);
    }
  }
}

/**
 * A ```diff somelang``` fence cannot be expressed through Shiki: its `diff`
 * grammar only colors the +/− markers and Shiki core has no `diff + lang`
 * meta handling. This plugin runs before rehype-shiki and renders such fences
 * as a syntax-highlighted diff table. Fences without a second word (plain
 * ```diff```) are left untouched for rehype-shiki's diff grammar. The
 * transformer is async like rehype-shiki's lazy mode, so the pipeline (and
 * MarkdownHooks' client-side processing) awaits it.
 */
export function rehypeDiffFence() {
  return (tree: unknown) => transform(tree as HNode);
}
