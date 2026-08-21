import type { Element, ElementContent, Properties, Root, Text } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, useEffect, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import type { BundledLanguage } from "shiki";
import { codeToHast } from "shiki";

import { shikiThemeOptions } from "./shiki-options";

export type DiffLine =
  | { kind: "add"; newLine?: number; content: string }
  | { kind: "remove"; oldLine?: number; content: string }
  | { kind: "context"; oldLine?: number; newLine?: number; content: string }
  | { kind: "ellipsis" }
  | { kind: "plain"; content: string };

const DIFF_LINE_RE = /^([+-\s])(\s*\d+)\s(.*)$/;
const ELLIPSIS_RE = /^\s*\.\.\.\s*$/;
const DIFF_HEADER_RE = /^(?:---|\+\+\+)(?:\s|$)/;
const DIFF_SIGN_RE = /^([+-])(.*)$/;
const CONTEXT_RE = /^( )(.*)$/;

export type DiffFormat = "numbered" | "unified";

export function parseDiff(diff: string, format: DiffFormat = "unified"): DiffLine[] {
  const rows: DiffLine[] = [];
  for (const raw of diff.split("\n")) {
    if (format === "unified") {
      if (DIFF_HEADER_RE.test(raw)) {
        rows.push({ kind: "plain", content: raw });
        continue;
      }
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

const EXTENSION_TO_LANG: Record<string, string> = {
  h: "c",
  htm: "html",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  ex: "elixir",
  exs: "elixir",
  ml: "ocaml",
};

export function langForPath(path?: string): string | undefined {
  if (!path) return undefined;
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? (EXTENSION_TO_LANG[ext] ?? ext) : undefined;
}

export type DiffRowSegment = { index: number; content: string };

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

type HighlightedLine = ElementContent[];

export type DiffHighlight = {
  lines: Map<number, HighlightedLine>;
  style?: string;
};

function firstElement(node: Root | Element | undefined, tagName: string): Element | undefined {
  const child = node?.children.find(
    (child) => child.type === "element" && child.tagName === tagName,
  );
  return child?.type === "element" && child.tagName === tagName ? child : undefined;
}

function highlightedLines(tree: Root): { lines: Element[]; style?: string } {
  const pre = firstElement(tree, "pre");
  const code = firstElement(pre, "code");
  return {
    lines:
      code?.children.filter(
        (child): child is Element => child.type === "element" && child.tagName === "span",
      ) ?? [],
    style: typeof pre?.properties.style === "string" ? pre.properties.style : undefined,
  };
}

function diffTokenChildren(line: Element | undefined): HighlightedLine {
  return (
    line?.children.map((child) => {
      if (child.type !== "element") return child;
      return {
        ...child,
        properties: { ...child.properties, className: ["diff-token"] },
      };
    }) ?? []
  );
}

async function themeStyle(): Promise<string | undefined> {
  try {
    return highlightedLines(
      await codeToHast("", { ...shikiThemeOptions, lang: "text" as BundledLanguage }),
    ).style;
  } catch {
    return undefined;
  }
}

export async function highlightSegments(
  segments: DiffRowSegment[][],
  lang?: string,
): Promise<DiffHighlight> {
  const lines = new Map<number, HighlightedLine>();
  let style: string | undefined;

  await Promise.all(
    segments.map(async (segment) => {
      if (!lang) return;
      const code = segment.map((row) => row.content).join("\n");
      try {
        const highlighted = highlightedLines(
          await codeToHast(code, { ...shikiThemeOptions, lang: lang as BundledLanguage }),
        );
        style ??= highlighted.style;
        segment.forEach((row, i) => lines.set(row.index, diffTokenChildren(highlighted.lines[i])));
      } catch {
        return;
      }
    }),
  );

  return { lines, style: style ?? (await themeStyle()) };
}

function element(
  tagName: string,
  properties: Properties,
  children: ElementContent[] = [],
): Element {
  return { type: "element", tagName, properties, children };
}

function text(value: string): Text {
  return { type: "text", value };
}

function classNames(...parts: Array<string | undefined>): string[] {
  return parts.filter((part): part is string => part !== undefined && part !== "");
}

function rowElement(line: DiffLine, highlighted: HighlightedLine | undefined): Element {
  if (line.kind === "ellipsis") {
    return element("tr", { className: ["text-gray-400", "dark:text-gray-600"] }, [
      element("td", { colSpan: 3, className: ["px-2", "select-none"] }, [text("\u2026")]),
    ]);
  }

  const { rowClass, sign, signClass, plainClass, oldLine, newLine } = diffRowStyle(line);
  const hasHighlight = highlighted !== undefined && highlighted.length > 0;
  const content: ElementContent[] = [
    element("span", { className: classNames("select-none", signClass) }, [text(sign)]),
  ];
  if (hasHighlight) content.push(...highlighted);
  else
    content.push(
      element("span", plainClass ? { className: [plainClass] } : {}, [text(line.content)]),
    );

  return element("tr", rowClass ? { className: [rowClass] } : {}, [
    element(
      "td",
      { className: classNames("w-9", "px-2", "text-right", "select-none", signClass) },
      [text(String(oldLine ?? ""))],
    ),
    element(
      "td",
      { className: classNames("w-9", "px-2", "text-right", "select-none", signClass) },
      [text(String(newLine ?? ""))],
    ),
    element("td", { className: ["pr-2", "whitespace-pre"] }, content),
  ]);
}

export function diffTableElement(lines: DiffLine[], highlighted: DiffHighlight): Element {
  const table = element(
    "table",
    {
      className: ["w-full", "border-collapse", "font-mono", "text-xs", "leading-5", "tabular-nums"],
    },
    [
      element(
        "tbody",
        {},
        lines.map((line, i) => rowElement(line, highlighted.lines.get(i))),
      ),
    ],
  );
  const properties: Properties = {
    className: classNames("diff-view", "not-prose", "rounded-lg", "overflow-auto", "max-h-80"),
  };
  if (highlighted.style) properties.style = highlighted.style;
  return element("div", properties, [table]);
}

export interface DiffViewProps {
  path?: string;
  lang?: string;
  format?: DiffFormat;
  diff: string;
}

const jsxRuntime = { Fragment, jsx, jsxs };

export function DiffView({ path, diff, lang: langOverride, format = "unified" }: DiffViewProps) {
  const lines = useMemo(() => parseDiff(diff, format), [diff, format]);
  const lang = useMemo(() => langOverride ?? langForPath(path), [langOverride, path]);
  const [highlighted, setHighlighted] = useState<DiffHighlight>({ lines: new Map() });

  useEffect(() => {
    let cancelled = false;
    setHighlighted({ lines: new Map() });
    void highlightSegments(consecutiveCodeSegments(lines), lang).then((result) => {
      if (!cancelled) setHighlighted(result);
    });
    return () => {
      cancelled = true;
    };
  }, [lines, lang]);

  return toJsxRuntime(diffTableElement(lines, highlighted), jsxRuntime);
}

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
