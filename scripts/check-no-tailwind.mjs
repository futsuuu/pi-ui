// Fails when a Tailwind-style utility class literal reappears in app source.
// Panda styles must be written with css()/cva or live in app/panda.css;
// raw class strings silently generate no CSS now that Tailwind is gone.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const UTILITY_RE =
  /\b(flex|grid|hidden|block|inline-|items-[a-z]|justify-[a-z]|gap-\d|p[xytlrb]?-\d|m[xytlrb]?-\d|space-[xy]-|text-(xs|sm|base|lg|xl|[a-z]+-\d)|bg-[a-z]+-\d|bg-white|bg-black|border-[trblxy]?-?[a-z]*-\d|rounded(-[a-z]+)?|shadow-[a-z]|\w+:(hover|focus|dark|disabled|data)-|w-\d|h-\d|max-[wh]-|min-[wh]-|truncate|uppercase|lowercase|capitalize|animate-\w+|transition-\w+)/;

const ALLOWED = new Set(["font-mono", "prose"]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk("app")) {
  const src = readFileSync(file, "utf8");
  const literals = src.matchAll(/(?:className|class)=["']([^"']+)["']/g);
  for (const [, value] of literals) {
    for (const cls of value.split(/\s+/)) {
      if (!cls || ALLOWED.has(cls)) continue;
      if (UTILITY_RE.test(cls)) offenders.push(`${file}: "${value}"`);
    }
  }
}

if (offenders.length > 0) {
  console.error("Raw utility-like class strings found (use css()/cva instead):");
  for (const line of [...new Set(offenders)]) console.error(`  ${line}`);
  process.exit(1);
}
