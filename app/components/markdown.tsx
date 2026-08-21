import rehypeShiki, { type RehypeShikiOptions } from "@shikijs/rehype";
import type { ComponentProps } from "react";
import { MarkdownHooks, type Components, type ExtraProps, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

import { rehypeDiffFence } from "./rehype-diff-fence";
import { shikiThemeOptions } from "./shiki-options";

const shikiOptions: RehypeShikiOptions = {
  ...shikiThemeOptions,
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

// rehypeDiffFence renders ```diff somelang``` fences (the diff grammar cannot
// express a second language); fences without one stay on rehype-shiki.
const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [
  rehypeDiffFence,
  [rehypeShiki, shikiOptions],
];

type AnchorProps = ComponentProps<"a"> & ExtraProps;
type TableProps = ComponentProps<"table"> & ExtraProps;

const components: Components = {
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
};

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
