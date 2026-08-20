import type { Element, ElementContent, Properties, Root, Text } from "hast";
import { toString } from "hast-util-to-string";
import type { ThemedToken } from "shiki";
import { visit } from "unist-util-visit";

import {
  type DiffLine,
  consecutiveCodeSegments,
  diffRowStyle,
  getThemeBgVars,
  highlightSegments,
  parseDiff,
} from "./diff-view";

/**
 * A `<code>` element carrying mdast-util-to-hast's fence info string (the
 * `meta` field is not part of hast's core types).
 */
type FenceCode = Element & { data?: { meta?: unknown } };

function el(tagName: string, properties: Properties, children: ElementContent[] = []): Element {
  return { type: "element", tagName, properties, children };
}

function text(value: string): Text {
  return { type: "text", value };
}

/** Build a `className` property from non-empty parts (hast class names are arrays). */
function cls(...parts: Array<string | undefined>): Array<string> {
  return parts.filter((part): part is string => part !== undefined && part !== "");
}

function diffFence(pre: Element): { lang: string; code: string } | undefined {
  const code = pre.children[0];
  if (code?.type !== "element" || code.tagName !== "code") return undefined;
  const className = code.properties?.className;
  if (!(Array.isArray(className) && className.includes("language-diff"))) return undefined;
  const meta = (code as FenceCode).data?.meta;
  if (typeof meta !== "string" || meta.trim() === "") return undefined;
  // The first word of the info string after `diff` is the language (Shiki
  // resolves aliases like `ts` → typescript at tokenization time).
  const lang = meta.trim().split(/\s+/)[0] ?? "";
  // mdast-util-to-hast appends a trailing newline to fence bodies; drop it so
  // parseDiff does not see an empty trailing row.
  return { lang, code: toString(code).replace(/\n$/, "") };
}

function styleString(style: Record<string, string | undefined> | undefined): string | undefined {
  if (!style) return undefined;
  const declarations = Object.entries(style)
    .filter((entry): entry is [string, string] => entry[1] != null)
    .map(([key, value]) => `${key}:${value}`);
  return declarations.length > 0 ? declarations.join(";") : undefined;
}

function rowElement(line: DiffLine, tokens: ThemedToken[] | undefined): Element {
  if (line.kind === "ellipsis") {
    return el("tr", { className: ["text-gray-400", "dark:text-gray-600"] }, [
      el("td", { colSpan: 3, className: ["px-2", "select-none"] }, [text("\u2026")]),
    ]);
  }

  const { rowClass, sign, signClass, plainClass, oldLine, newLine } = diffRowStyle(line);
  const hasTokens = tokens !== undefined && tokens.length > 0;

  const content: ElementContent[] = [
    el("span", { className: cls("select-none", signClass) }, [text(sign)]),
  ];
  if (hasTokens) {
    for (const token of tokens) {
      const props: Properties = { className: ["diff-token"] };
      const style = styleString(token.htmlStyle);
      if (style) props.style = style;
      content.push(el("span", props, [text(token.content)]));
    }
  } else {
    content.push(
      el("span", plainClass ? { className: cls(plainClass) } : {}, [text(line.content)]),
    );
  }

  return el("tr", rowClass ? { className: cls(rowClass) } : {}, [
    el("td", { className: cls("w-9", "px-2", "text-right", "select-none", signClass) }, [
      text(String(oldLine ?? "")),
    ]),
    el("td", { className: cls("w-9", "px-2", "text-right", "select-none", signClass) }, [
      text(String(newLine ?? "")),
    ]),
    el("td", { className: ["pr-2", "whitespace-pre"] }, content),
  ]);
}

/**
 * Build the full diff-table HAST for a ```diff lang``` fence, mirroring the
 * DiffView React component (same row classes, gutters, signs, and per-segment
 * tokenization).
 */
async function diffTableElement(lang: string, code: string): Promise<Element> {
  const lines = parseDiff(code);
  const [tokenLines, bgVars] = await Promise.all([
    highlightSegments(consecutiveCodeSegments(lines), lang),
    getThemeBgVars(),
  ]);
  const table = el(
    "table",
    {
      className: ["w-full", "border-collapse", "font-mono", "text-xs", "leading-5", "tabular-nums"],
    },
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
  const props: Properties = {
    className: cls("diff-view", "not-prose", "rounded-lg", "overflow-auto", "max-h-80"),
  };
  const style = styleString(bgVars);
  if (style) props.style = style;
  return el("div", props, [table]);
}

/**
 * A ```diff somelang``` fence cannot be expressed through Shiki: its `diff`
 * grammar only colors the +/− markers, and Shiki core has no `diff + lang`
 * meta handling. This plugin runs before rehype-shiki and renders such
 * fences as a syntax-highlighted diff table; plain ```diff``` stays on the
 * rehype-shiki diff grammar. Its transformer is async like rehype-shiki's
 * lazy mode.
 */
export function rehypeDiffFence() {
  return async (tree: Root) => {
    const queue: Array<Promise<void>> = [];
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "pre" || index === undefined || parent === undefined) return;
      const fence = diffFence(node);
      if (!fence) return;
      // Replace the fence after its table is built; the visits are collected
      // first so the replacement output is never re-walked.
      const { lang, code } = fence;
      queue.push(
        diffTableElement(lang, code).then((replacement) => {
          parent.children[index] = replacement;
        }),
      );
    });
    await Promise.all(queue);
  };
}
