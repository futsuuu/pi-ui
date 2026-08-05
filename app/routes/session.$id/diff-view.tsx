import { useEffect, useMemo, useState } from "react";
import type { BundledLanguage, ThemedToken } from "shiki";
import { codeToTokens } from "shiki";

/**
 * One parsed line of the edit tool's display-oriented diff, i.e. the format
 * produced by `generateDiffString` in @earendil-works/pi-coding-agent
 * (`details.diff` of the edit tool result). Every line is
 * `sign + padded line number + " " + content` where the number is the new
 * line number for additions, the old one for removals and context, and absent
 * on the "..." rows used to skip unchanged ranges.
 */
export type DiffLine =
  | { kind: "add"; newLine: number; content: string }
  | { kind: "remove"; oldLine: number; content: string }
  | { kind: "context"; oldLine: number; newLine: number; content: string }
  | { kind: "ellipsis" }
  | { kind: "plain"; content: string };

const DIFF_LINE_RE = /^([+-\s])(\s*\d*)\s(.*)$/;

/** Split a display-oriented diff into typed rows with resolved line numbers. */
export function parseDiff(diff: string): DiffLine[] {
  const rows: DiffLine[] = [];
  for (const raw of diff.split("\n")) {
    const match = DIFF_LINE_RE.exec(raw);
    if (!match) {
      rows.push({ kind: "plain", content: raw });
      continue;
    }
    const lineNumField = match[2].trim();
    if (lineNumField === "") {
      rows.push({ kind: "ellipsis" });
      continue;
    }
    const lineNum = Number(lineNumField);
    const content = match[3];
    if (match[1] === "+") rows.push({ kind: "add", newLine: lineNum, content });
    else if (match[1] === "-") rows.push({ kind: "remove", oldLine: lineNum, content });
    else rows.push({ kind: "context", oldLine: lineNum, newLine: lineNum, content });
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
 * Tokenize a single diff line with the file's language, using the same dual
 * theme setup as the Markdown renderer: tokens carry `--shiki-light` /
 * `--shiki-dark` CSS variables and the `.diff-token` rule in app.css picks
 * the active theme. Results are memoized per (language, content) so repeated
 * lines in a diff only tokenize once.
 */
const tokenCache = new Map<string, ThemedToken[]>();

async function highlightLine(content: string, lang: string): Promise<ThemedToken[]> {
  const key = `${lang}\n${content}`;
  const cached = tokenCache.get(key);
  if (cached) return cached;
  try {
    const { tokens } = await codeToTokens(content, {
      // EXTENSION_TO_LANG only contains bundled language ids; the cast keeps
      // the call typed while the try/catch falls back to plain text if a
      // grammar is ever missing at runtime.
      lang: lang as BundledLanguage,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
    const tokensForLine = tokens[0] ?? [];
    tokenCache.set(key, tokensForLine);
    return tokensForLine;
  } catch {
    return [];
  }
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
  /** Display-oriented diff text (the edit tool's `details.diff`). */
  diff: string;
}

/**
 * Render a display-oriented diff (edit tool `details.diff`) as a GitHub-style
 * table: old/new line-number gutters, colored add/remove rows, and per-line
 * syntax highlighting via Shiki. Highlighting is applied client-side after
 * mount so the server render stays plain (no hydration mismatch).
 */
export function DiffView({ path, diff }: DiffViewProps) {
  const lines = useMemo(() => parseDiff(diff), [diff]);
  const lang = useMemo(() => langForPath(path), [path]);
  const [bgVars, setBgVars] = useState<Record<string, string> | undefined>(undefined);
  const [tokenLines, setTokenLines] = useState<Map<string, ThemedToken[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    // The background is theme-level (independent of the file's language), so
    // it is fetched even when the language is unknown.
    void getThemeBgVars().then((vars) => {
      if (!cancelled) setBgVars(vars);
    });
    if (lang) {
      const unique = new Set(
        lines
          .filter(
            (line) => line.kind === "add" || line.kind === "remove" || line.kind === "context",
          )
          .map((line) => line.content),
      );
      void Promise.all(
        [...unique].map(async (content) => [content, await highlightLine(content, lang)] as const),
      ).then((entries) => {
        if (!cancelled) setTokenLines(new Map(entries));
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
            <DiffRow
              key={i}
              line={line}
              tokens={"content" in line ? tokenLines.get(line.content) : undefined}
            />
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
