import type { Element, Root } from "hast";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";

import {
  consecutiveCodeSegments,
  diffTableElement,
  highlightSegments,
  parseDiff,
} from "./diff-view";

type FenceCode = Element & { data?: { meta?: unknown } };

function diffFence(pre: Element): { lang: string; code: string } | undefined {
  const code = pre.children[0];
  if (code?.type !== "element" || code.tagName !== "code") return undefined;
  const className = code.properties?.className;
  if (!(Array.isArray(className) && className.includes("language-diff"))) return undefined;
  const meta = (code as FenceCode).data?.meta;
  if (typeof meta !== "string" || meta.trim() === "") return undefined;
  const lang = meta.trim().split(/\s+/)[0] ?? "";
  return { lang, code: toString(code).replace(/\n+$/, "") };
}

async function diffTable(lang: string, code: string): Promise<Element> {
  const lines = parseDiff(code);
  const highlighted = await highlightSegments(consecutiveCodeSegments(lines), lang);
  return diffTableElement(lines, highlighted);
}

export function rehypeDiffFence() {
  return async (tree: Root) => {
    const queue: Array<Promise<void>> = [];
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "pre" || index === undefined || parent === undefined) return;
      const fence = diffFence(node);
      if (!fence) return;
      const { lang, code } = fence;
      queue.push(
        diffTable(lang, code).then((replacement) => {
          parent.children[index] = replacement;
        }),
      );
    });
    await Promise.all(queue);
  };
}
