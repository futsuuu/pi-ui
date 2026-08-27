import type { Element, ElementContent, Properties, Root, Text } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, useEffect, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import type { BundledLanguage } from "shiki";
import { codeToHast } from "shiki";
import { css } from "styled-system/css";

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
  const normalized = diff.replace(/(?:\r?\n)+$/, "");
  for (const raw of normalized === "" ? [] : normalized.split(/\r?\n/)) {
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

/** Stable Panda-generated classes shared with tests that assert row styling. */
export const diffRowClass = {
  add: css({ backgroundColor: "success.wash" }),
  remove: css({ backgroundColor: "danger.wash" }),
};

const ellipsisRowStyle = css({ color: "subtle.fg" });
const ellipsisCellStyle = css({ paddingInline: "2", userSelect: "none" });
const signSpanStyle = css({ userSelect: "none" });
const lineNumberStyle = css({
  width: "9",
  paddingInline: "2",
  textAlign: "right",
  userSelect: "none",
});
const contentCellStyle = css({ paddingRight: "2", whiteSpace: "pre" });
const tableStyle = css({
  width: "full",
  borderCollapse: "collapse",
  fontFamily: "mono",
  textStyle: "xs",
  lineHeight: "diff.lineHeight",
  fontVariantNumeric: "tabular-nums",
});
const wrapperStyle = css({ borderRadius: "lg", overflow: "auto", maxHeight: "diff.maxHeight" });

function classNames(...parts: Array<string | undefined>): string[] {
  return parts.filter((part): part is string => part !== undefined && part !== "");
}

function rowElement(line: DiffLine, highlighted: HighlightedLine | undefined): Element {
  if (line.kind === "ellipsis") {
    return element("tr", { className: [ellipsisRowStyle] }, [
      element("td", { colSpan: 3, className: [ellipsisCellStyle] }, [text("\u2026")]),
    ]);
  }

  const { rowClass, sign, signClass, oldLine, newLine } = diffRowStyle(line);
  const hasHighlight = highlighted !== undefined && highlighted.length > 0;
  const content: ElementContent[] = [
    element("span", { className: classNames(signSpanStyle, signClass) }, [text(sign)]),
  ];
  if (hasHighlight) content.push(...highlighted);
  else content.push(element("span", {}, [text(line.content)]));

  return element("tr", rowClass ? { className: [rowClass] } : {}, [
    element("td", { className: classNames(lineNumberStyle, signClass) }, [
      text(String(oldLine ?? "")),
    ]),
    element("td", { className: classNames(lineNumberStyle, signClass) }, [
      text(String(newLine ?? "")),
    ]),
    element("td", { className: [contentCellStyle] }, content),
  ]);
}

export function diffTableElement(lines: DiffLine[], highlighted: DiffHighlight): Element {
  const table = element(
    "table",
    {
      className: [tableStyle],
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
    className: classNames(wrapperStyle, "diff-view", "not-prose"),
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
  rowClass: string | undefined;
  sign: string;
  signClass: string | undefined;
  oldLine: number | undefined;
  newLine: number | undefined;
} {
  const isAdd = line.kind === "add";
  const isRemove = line.kind === "remove";
  return {
    rowClass: isAdd ? diffRowClass.add : isRemove ? diffRowClass.remove : undefined,
    sign: isAdd ? "+" : isRemove ? "-" : " ",
    signClass: isAdd ? successSignClass : isRemove ? dangerSignClass : contextSignClass,
    oldLine: line.kind === "remove" || line.kind === "context" ? line.oldLine : undefined,
    newLine: line.kind === "add" || line.kind === "context" ? line.newLine : undefined,
  };
}

const successSignClass = css({ color: "success" });
const dangerSignClass = css({ color: "danger" });
const contextSignClass = css({ color: "subtle.fg" });
