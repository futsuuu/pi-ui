import rehypeShiki, { type RehypeShikiOptions } from "@shikijs/rehype";
import { MarkdownHooks, type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

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

const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [[rehypeShiki, shikiOptions]];

const components: Components = {
  a: ({ node: _node, href, children, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  ),
  // Keep wide tables scrollable within the message instead of widening the screen.
  table: ({ node: _node, ...props }) => (
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
