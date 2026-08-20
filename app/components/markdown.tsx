import rehypeShiki, { type RehypeShikiOptions } from "@shikijs/rehype";
import type { ReactNode } from "react";
import { MarkdownHooks, type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

import { DiffView } from "./diff-view";

const shikiOptions: RehypeShikiOptions = {
  // Dual themes via CSS variables (--shiki-light / --shiki-dark), toggled by `.dark` in app.css.
  themes: { light: "github-light", dark: "github-dark" },
  defaultColor: false,
  addLanguageClass: true,
  // Do not preload any grammar: every language is loaded on demand when a code
  // fence uses it (grammars are already split into lazy chunks by the bundler).
  langs: [],
  lazy: true,
  // Render fences without an explicit language as plain text through Shiki so
  // they get the same themed background as other code blocks.
  defaultLanguage: "text",
  // Unknown/unavailable languages render as plain text instead of erroring.
  fallbackLanguage: "text",
};

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

/**
 * A ```diff somelang``` fence cannot be expressed through Shiki: its `diff`
 * grammar only colors the +/− markers and Shiki core has no `diff + lang`
 * meta handling. This plugin runs before rehype-shiki and rewrites such
 * fences into <md-diff> elements, which the components map renders as a
 * syntax-highlighted DiffView. Fences without a second word (plain ```diff```)
 * are left untouched for rehype-shiki's diff grammar.
 */
function isDiffFence(pre: HElement): boolean {
  const code = pre.children[0];
  if (!isElement(code) || code.tagName !== "code") return false;
  if (!hasLanguageClass(code, "diff")) return false;
  const meta = code.data?.meta;
  return typeof meta === "string" && meta.trim() !== "";
}

function toDiffElement(pre: HElement): HElement {
  const code = pre.children[0] as HElement;
  const meta = code.data?.meta as string;
  // The first word of the info string after `diff` is the language (Shiki
  // resolves aliases like `ts` → typescript at tokenization time).
  const lang = meta.trim().split(/\s+/)[0] ?? "";
  // mdast-util-to-hast appends a trailing newline to fence bodies; drop it so
  // parseDiff does not see an empty trailing row.
  const value = codeText(code).replace(/\n$/, "");
  return {
    type: "element",
    tagName: "md-diff",
    properties: { "data-lang": lang },
    children: [{ type: "text", value }],
  };
}

function transform(node: HNode): void {
  if (node.type !== "element" && node.type !== "root") return;
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!isElement(child)) continue;
    if (child.tagName === "pre" && isDiffFence(child)) {
      children[i] = toDiffElement(child);
    } else {
      transform(child);
    }
  }
}

function rehypeDiffFence() {
  return (tree: unknown) => transform(tree as HNode);
}

const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [
  rehypeDiffFence as unknown as NonNullable<Options["rehypePlugins"]>[number],
  [rehypeShiki, shikiOptions],
];

interface AnchorProps {
  node?: unknown;
  href?: string;
  children?: ReactNode;
  [prop: string]: unknown;
}

interface TableProps {
  node?: unknown;
  children?: ReactNode;
  [prop: string]: unknown;
}

interface DiffFenceProps {
  /** Language carried on the <md-diff data-lang="..."> element. */
  "data-lang"?: string;
  children?: ReactNode;
}

function DiffFence({ "data-lang": lang, children }: DiffFenceProps) {
  return (
    // not-prose: the GitHub-style diff table is styled by DiffView itself and
    // must not pick up @tailwindcss/typography table rules. The format
    // defaults to `unified`, which is the fence layout.
    <div className="not-prose">
      <DiffView lang={lang} diff={toText(children)} />
    </div>
  );
}

function toText(children: ReactNode): string {
  return Array.isArray(children)
    ? children.map((child) => (typeof child === "string" ? child : "")).join("")
    : typeof children === "string"
      ? children
      : "";
}

// "md-diff" is a custom element name, so it is not a key of
// JSX.IntrinsicElements; the entry is added via a cast.
const components = {
  a: ({ node: _node, href, children, ...props }: AnchorProps) => (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  ),
  // Keep wide tables scrollable within the message instead of widening the screen.
  table: ({ node: _node, ...props }: TableProps) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
  "md-diff": DiffFence,
} as unknown as Components;

export interface Props {
  children: string;
}

/** Render assistant message text as GitHub-flavored Markdown with Shiki highlighting. */
export function Markdown({ children }: Props) {
  return (
    <div className="prose dark:prose-invert max-w-none break-words">
      <MarkdownHooks
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {children}
      </MarkdownHooks>
    </div>
  );
}
