import { useEffect, useMemo, useState } from "react";
import type { BundledLanguage, ThemedToken } from "shiki";
import { codeToTokens } from "shiki";

/**
 * One parsed line of a diff. In the `numbered` format (the edit tool's
 * `details.diff`) add/remove/context rows carry their line numbers; in the
 * `unified` format (```diff somelang fences) they do not. Which format a
 * string is in is known statically by the caller (`format` on parseDiff), so
 * the optional fields here only reflect the two layouts sharing one type.
 */
export type DiffLine =
  | { kind: "add"; newLine?: number; content: string }
  | { kind: "remove"; oldLine?: number; content: string }
  | { kind: "context"; oldLine?: number; newLine?: number; content: string }
  | { kind: "ellipsis" }
  | { kind: "plain"; content: string };

const DIFF_LINE_RE = /^([+-\s])(\s*\d+)\s(.*)$/;
const ELLIPSIS_RE = /^\s*\.\.\.\s*$/;
const DIFF_SIGN_RE = /^([+-])(?!\1)(.*)$/;
const CONTEXT_RE = /^( )(.*)$/;

/** Which diff layout a string is in; the caller knows this statically. */
export type DiffFormat = "numbered" | "unified";

/**
 * Split a diff into typed rows. `numbered` is the display-oriented format of
 * the edit tool (`generateDiffString`), `unified` the plain diff of a
 * ```diff somelang fence; the two only differ in whether rows carry line
 * numbers, so the format is passed in instead of guessed from the content (a
 * unified `+2 x` would otherwise be ambiguous with a numbered row). Defaults
 * to `unified`, matching DiffView.
 */
export function parseDiff(diff: string, format: DiffFormat = "unified"): DiffLine[] {
  const rows: DiffLine[] = [];
  for (const raw of diff.split("\n")) {
    if (format === "unified") {
      // Sign directly attached to the content. A doubled sign (`---`/`+++`)
      // is a file header, not a changed line.
      const signed = DIFF_SIGN_RE.exec(raw);
      if (signed) {
        rows.push(
          signed[1] === "+"
            ? { kind: "add", content: signed[2] }
            : { kind: "remove", content: signed[2] },
        );
        continue;
      }
      const context = CONTEXT_RE.exec(raw);
      if (context) {
        rows.push({ kind: "context", content: context[2] });
        continue;
      }
      rows.push({ kind: "plain", content: raw });
      continue;
    }
    // `+2 content` is an addition at new line 2; rows without a number
    // (ellipsis, headers) fall through to plain.
    const numbered = DIFF_LINE_RE.exec(raw);
    if (numbered) {
      const lineNum = Number(numbered[2].trim());
      const content = numbered[3];
      if (numbered[1] === "+") rows.push({ kind: "add", newLine: lineNum, content });
      else if (numbered[1] === "-") rows.push({ kind: "remove", oldLine: lineNum, content });
      else rows.push({ kind: "context", oldLine: lineNum, newLine: lineNum, content });
      continue;
    }
    if (ELLIPSIS_RE.test(raw)) {
      rows.push({ kind: "ellipsis" });
      continue;
    }
    rows.push({ kind: "plain", content: raw });
  }
  return rows;
}

/**
 * Extension → Shiki language map. Mirrors `getLanguageFromPath` in
 * @earendil-works/pi-coding-agent (which is not browser-safe: it pulls in
 * node:fs / pi-tui). Unknown extensions return `undefined` and render plain.
 */
const EXTENSION_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmake: "cmake",
  lua: "lua",
  perl: "perl",
  r: "r",
  scala: "scala",
  clj: "clojure",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  vim: "vim",
  graphql: "graphql",
  proto: "protobuf",
  tf: "hcl",
  hcl: "hcl",
};

/** Resolve the Shiki language for a file path (or `undefined` for plain text). */
export function langForPath(path?: string): string | undefined {
  if (!path) return undefined;
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_TO_LANG[ext] : undefined;
}

/**
 * Tokenize each run of consecutive code rows separately. The grammar state
 * flows across diff rows within a run, so multi-line constructs (block
 * comments, template literals, ...) spanning diff rows keep their syntax;
 * it resets at omissions (ellipsis, headers), because the skipped lines'
 * content is unknown — a run after an omission starts fresh instead of
 * misreading code as comment content. Results are cached per (language,
 * stream) so unchanged runs only tokenize once.
 */
const tokenCache = new Map<string, ThemedToken[][]>();

async function highlightSegments(
  segments: { index: number; content: string }[][],
  lang: string,
): Promise<Map<number, ThemedToken[]>> {
  const byIndex = new Map<number, ThemedToken[]>();
  for (const segment of segments) {
    const code = segment.map((row) => row.content).join("\n");
    const key = `${lang}\n${code}`;
    let tokens = tokenCache.get(key);
    if (!tokens) {
      try {
        tokens = (
          await codeToTokens(code, {
            // EXTENSION_TO_LANG only contains bundled language ids; the cast
            // keeps the call typed while the try/catch falls back to plain text
            // if a grammar is ever missing at runtime.
            lang: lang as BundledLanguage,
            themes: { light: "github-light", dark: "github-dark" },
            defaultColor: false,
          })
        ).tokens;
        tokenCache.set(key, tokens);
      } catch {
        continue;
      }
    }
    // Line i of the stream belongs to the i-th row of the segment.
    segment.forEach((row, i) => byIndex.set(row.index, tokens[i] ?? []));
  }
  return byIndex;
}

/**
 * The dual-theme background CSS variables from the Shiki themes
 * (`--shiki-light-bg` / `--shiki-dark-bg`), so the diff container matches the
 * code-block background of the Markdown renderer. Theme-level, so it is
 * fetched once and cached (the "text" language needs no grammar).
 */
let themeBgVarsCache: Record<string, string> | undefined;

async function getThemeBgVars(): Promise<Record<string, string> | undefined> {
  if (themeBgVarsCache) return themeBgVarsCache;
  try {
    const { bg } = await codeToTokens("", {
      lang: "text" as BundledLanguage,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
    // bg: "--shiki-light-bg:#fff;--shiki-dark-bg:#24292e"
    if (!bg) return undefined;
    const vars: Record<string, string> = {};
    for (const part of bg.split(";")) {
      const colon = part.indexOf(":");
      if (colon !== -1) vars[part.slice(0, colon)] = part.slice(colon + 1);
    }
    themeBgVarsCache = vars;
    return vars;
  } catch {
    return undefined;
  }
}

export interface DiffViewProps {
  /** File path used to pick the highlighting language (optional). */
  path?: string;
  /** Explicit highlighting language, overriding `path` (a ```diff somelang``` fence). */
  lang?: string;
  /**
   * Diff layout. Defaults to `unified` (the ```diff somelang fence format,
   * which is the common case); the edit tool's `details.diff` passes
   * `numbered`.
   */
  format?: DiffFormat;
  /** Diff text in the given format (fence body / edit tool `details.diff`). */
  diff: string;
}

/**
 * Render a diff (edit tool `details.diff` or a ```diff somelang``` fence) as
 * a GitHub-style table: old/new line-number gutters, colored add/remove rows,
 * and whole-block syntax highlighting via Shiki so multi-line constructs
 * tokenize correctly. Highlighting is applied client-side after mount so the
 * server render stays plain (no hydration mismatch).
 */
export function DiffView({ path, diff, lang: langOverride, format = "unified" }: DiffViewProps) {
  const lines = useMemo(() => parseDiff(diff, format), [diff, format]);
  const lang = useMemo(() => langOverride ?? langForPath(path), [langOverride, path]);
  const [bgVars, setBgVars] = useState<Record<string, string> | undefined>(undefined);
  const [tokenLines, setTokenLines] = useState<Map<number, ThemedToken[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    // The background is theme-level (independent of the file's language), so
    // it is fetched even when the language is unknown.
    void getThemeBgVars().then((vars) => {
      if (!cancelled) setBgVars(vars);
    });
    if (lang) {
      // Runs of consecutive code rows; anything else (ellipsis, headers)
      // splits the stream so the grammar restarts after an omission.
      const segments: { index: number; content: string }[][] = [];
      let segment: { index: number; content: string }[] = [];
      lines.forEach((line, index) => {
        if (line.kind === "add" || line.kind === "remove" || line.kind === "context") {
          segment.push({ index, content: line.content });
        } else if (segment.length > 0) {
          segments.push(segment);
          segment = [];
        }
      });
      if (segment.length > 0) segments.push(segment);
      void highlightSegments(segments, lang).then((tokens) => {
        if (!cancelled) setTokenLines(tokens);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [lines, lang]);

  return (
    // Background matches the Shiki theme (via .diff-view in app.css + the
    // inline --shiki-*-bg vars); max-h-80 limits tall diffs to a scrollable
    // panel instead of expanding the whole message.
    <div className="diff-view rounded-lg overflow-auto max-h-80" style={bgVars}>
      <table className="w-full border-collapse font-mono text-xs leading-5 tabular-nums">
        <tbody>
          {lines.map((line, i) => (
            <DiffRow key={i} line={line} tokens={tokenLines.get(i)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffRow({ line, tokens }: { line: DiffLine; tokens?: ThemedToken[] }) {
  if (line.kind === "ellipsis") {
    return (
      <tr className="text-gray-400 dark:text-gray-600">
        <td colSpan={3} className="px-2 select-none">
          …
        </td>
      </tr>
    );
  }

  const isAdd = line.kind === "add";
  const isRemove = line.kind === "remove";
  const rowClass = isAdd
    ? "bg-green-50 dark:bg-green-950/40"
    : isRemove
      ? "bg-red-50 dark:bg-red-950/40"
      : "";
  const sign = isAdd ? "+" : isRemove ? "-" : " ";
  const signClass = isAdd
    ? "text-green-600 dark:text-green-400"
    : isRemove
      ? "text-red-600 dark:text-red-400"
      : "text-gray-400 dark:text-gray-500";
  const oldLine = line.kind === "remove" || line.kind === "context" ? line.oldLine : undefined;
  const newLine = line.kind === "add" || line.kind === "context" ? line.newLine : undefined;
  const hasTokens = tokens !== undefined && tokens.length > 0;

  return (
    <tr className={rowClass}>
      <td className={`w-9 px-2 text-right select-none ${signClass}`}>{oldLine ?? ""}</td>
      <td className={`w-9 px-2 text-right select-none ${signClass}`}>{newLine ?? ""}</td>
      <td className="pr-2 whitespace-pre">
        <span className={`select-none ${signClass}`}>{sign}</span>
        {hasTokens ? (
          tokens.map((token, i) => (
            <span key={i} className="diff-token" style={token.htmlStyle}>
              {token.content}
            </span>
          ))
        ) : (
          <span
            className={
              isAdd
                ? "text-green-800 dark:text-green-300"
                : isRemove
                  ? "text-red-800 dark:text-red-300"
                  : ""
            }
          >
            {line.content}
          </span>
        )}
      </td>
    </tr>
  );
}
