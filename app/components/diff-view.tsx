import { useEffect, useMemo, useState } from "react";
import type { BundledLanguage, ThemedToken } from "shiki";
import { codeToTokens } from "shiki";

/**
 * One parsed line of a diff. `numbered` rows (the edit tool's `details.diff`)
 * carry line numbers, `unified` rows (```diff somelang fences) do not; the
 * optional fields reflect the two layouts sharing one type.
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

export type DiffFormat = "numbered" | "unified";

/**
 * Split a diff into typed rows. The layout is passed in, not guessed from
 * the content: a unified `+2 x` would otherwise be ambiguous with a numbered
 * row. Defaults to `unified`, matching DiffView.
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
 * Extension → Shiki language map, mirroring the agent's own helper which
 * cannot be reused here (it pulls in Node-only modules, so it is not
 * browser-safe). Unknown extensions return `undefined` and render plain.
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

export function langForPath(path?: string): string | undefined {
  if (!path) return undefined;
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_TO_LANG[ext] : undefined;
}

/** A code row within a diff, positioned by its index in the parsed row list. */
export type DiffRowSegment = { index: number; content: string };

/**
 * Split a parsed diff into runs of consecutive code rows. Anything else
 * (ellipsis, headers) splits the stream, so the grammar restarts after an
 * omission instead of inheriting state from the skipped (unknown) lines.
 */
export function consecutiveCodeSegments(lines: DiffLine[]): DiffRowSegment[][] {
  const segments: DiffRowSegment[][] = [];
  let segment: DiffRowSegment[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.kind === "add" || line.kind === "remove" || line.kind === "context") {
      segment.push({ index, content: line.content });
    } else if (segment.length > 0) {
      segments.push(segment);
      segment = [];
    }
  }
  if (segment.length > 0) segments.push(segment);
  return segments;
}

/**
 * Tokenize each run of code rows as one stream (see consecutiveCodeSegments)
 * so multi-line constructs spanning diff rows keep their syntax; a segment's
 * i-th token line belongs to its i-th row.
 */
const tokenCache = new Map<string, ThemedToken[][]>();

export async function highlightSegments(
  segments: DiffRowSegment[][],
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
            // The cast is safe for bundled language ids; unknown langs fall
            // back to plain rows via the catch below.
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
    segment.forEach((row, i) => byIndex.set(row.index, tokens[i] ?? []));
  }
  return byIndex;
}

/**
 * The dual-theme background CSS variables (`--shiki-light-bg` /
 * `--shiki-dark-bg`), so the diff container matches code-block backgrounds.
 * Theme-level, so it is fetched once and cached.
 */
let themeBgVarsCache: Record<string, string> | undefined;

export async function getThemeBgVars(): Promise<Record<string, string> | undefined> {
  if (themeBgVarsCache) return themeBgVarsCache;
  try {
    const { bg } = await codeToTokens("", {
      lang: "text" as BundledLanguage,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
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
  /** File path used to pick the highlighting language. */
  path?: string;
  /** Explicit highlighting language, overriding `path`. */
  lang?: string;
  /** Diff layout; the edit tool's `details.diff` passes `numbered`. */
  format?: DiffFormat;
  diff: string;
}

/**
 * Render a diff as a GitHub-style table: old/new line-number gutters, colored
 * add/remove rows, and whole-block Shiki highlighting. Highlighting runs
 * client-side after mount so the server render stays plain (no hydration
 * mismatch).
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
      void highlightSegments(consecutiveCodeSegments(lines), lang).then((tokens) => {
        if (!cancelled) setTokenLines(tokens);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [lines, lang]);

  return (
    // max-h-80 keeps tall diffs in a scrollable panel instead of expanding
    // the whole message; the .diff-view style paints the Shiki theme bg.
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

/**
 * The row-level styling a diff row needs: the row background, the leading
 * sign and its color, the fallback content color (when no tokens are
 * available), and the old/new gutter numbers. Shared by the React DiffRow
 * and the rehype plugin's HAST builder so both render the same table.
 */
export function diffRowStyle(line: DiffLine): {
  rowClass: string;
  sign: string;
  signClass: string;
  plainClass: string;
  oldLine: number | undefined;
  newLine: number | undefined;
} {
  const isAdd = line.kind === "add";
  const isRemove = line.kind === "remove";
  return {
    rowClass: isAdd
      ? "bg-green-50 dark:bg-green-950/40"
      : isRemove
        ? "bg-red-50 dark:bg-red-950/40"
        : "",
    sign: isAdd ? "+" : isRemove ? "-" : " ",
    signClass: isAdd
      ? "text-green-600 dark:text-green-400"
      : isRemove
        ? "text-red-600 dark:text-red-400"
        : "text-gray-400 dark:text-gray-500",
    plainClass: isAdd
      ? "text-green-800 dark:text-green-300"
      : isRemove
        ? "text-red-800 dark:text-red-300"
        : "",
    oldLine: line.kind === "remove" || line.kind === "context" ? line.oldLine : undefined,
    newLine: line.kind === "add" || line.kind === "context" ? line.newLine : undefined,
  };
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

  const { rowClass, sign, signClass, plainClass, oldLine, newLine } = diffRowStyle(line);
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
          <span className={plainClass}>{line.content}</span>
        )}
      </td>
    </tr>
  );
}
