/**
 * Display-only path shortening for tool messages. Pure string logic so it
 * also runs in the browser; `cwd`/`home` tolerate a trailing slash, and an
 * empty or root value disables the corresponding rule.
 */

/** Normalize a path for display: collapse duplicate slashes and drop a
 * trailing slash (except the root). */
function normalizeForDisplay(p: string): string {
  const collapsed = p.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}

/** Canonical base form for `cwd`/`home`; the root matches no path. */
function canonicalBase(p: string): string {
  const norm = normalizeForDisplay(p);
  return norm === "/" ? "" : norm;
}

/**
 * Shorten a path for display: absolute paths under `cwd` become relative
 * (the cwd itself becomes "."), the home directory becomes "~", and a
 * redundant leading "./" is dropped. Relative and unrelated paths are
 * returned unchanged.
 */
export function displayPath(p: string, cwd: string, home: string): string {
  const path = normalizeForDisplay(p);
  const cwdNorm = canonicalBase(cwd);
  const homeNorm = canonicalBase(home);

  if (cwdNorm && (path === cwdNorm || path.startsWith(`${cwdNorm}/`))) {
    return path === cwdNorm ? "." : path.slice(cwdNorm.length + 1);
  }
  if (homeNorm && (path === homeNorm || path.startsWith(`${homeNorm}/`))) {
    return path === homeNorm ? "~" : `~${path.slice(homeNorm.length)}`;
  }
  if (path.startsWith("./")) return path.slice(2);
  return path;
}

/**
 * Shorten a bash command for display: a leading `cd <dir>` has its directory
 * shortened like a path, and a `cd` into the current directory drops the
 * whole prefix, leaving the rest of the command.
 */
export function displayBashCommand(command: string, cwd: string, home: string): string {
  const leading = /^cd\s+(\S+)\s*&&\s*([\s\S]*)$/.exec(command);
  if (leading) {
    const dir = displayPath(leading[1], cwd, home);
    return dir === "." ? leading[2] : `cd ${dir} && ${leading[2]}`;
  }
  const bare = /^cd\s+(\S+)\s*$/.exec(command);
  if (bare) return `cd ${displayPath(bare[1], cwd, home)}`;
  return command;
}

/**
 * Copy of a tool's args for display with the `path` and `command` fields
 * shortened; all other fields are kept as-is.
 */
export function displayToolArgs(
  args: Record<string, unknown>,
  cwd: string,
  home: string,
): Record<string, unknown> {
  const display = { ...args };
  if (typeof display.path === "string") display.path = displayPath(display.path, cwd, home);
  if (typeof display.command === "string") {
    display.command = displayBashCommand(display.command, cwd, home);
  }
  return display;
}
