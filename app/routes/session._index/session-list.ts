import { useCallback, useRef, useSyncExternalStore } from "react";

import { useSessionEventsContext } from "~/contexts/session-events";
import type { SessionInfo } from "~/session-info";
import type { Worktree } from "~/worktree-repository";

/** A session row for the list: stream info joined with its worktree badge. */
export interface SessionRow extends SessionInfo {
  worktree: Worktree | null;
}

/** Stable empty snapshot for server rendering and the pre-seed state. */
const EMPTY_ROWS: SessionRow[] = [];

/**
 * Filter the global session store to one project and attach the worktree
 * each session belongs to. Sessions under the project root get `null` (the
 * main worktree has no badge); sessions under a path that is neither the
 * root nor a listed worktree (e.g. a worktree deleted in another tab) are
 * dropped, mirroring the previous loader behavior.
 */
export function buildSessionRows(
  sessions: ReadonlyMap<string, SessionInfo>,
  worktrees: readonly Worktree[],
  cwd: string,
): SessionRow[] {
  const byPath = new Map(worktrees.map((worktree) => [worktree.path, worktree]));
  const rows: SessionRow[] = [];
  for (const info of sessions.values()) {
    if (info.cwd !== cwd && !byPath.has(info.cwd)) continue;
    rows.push({
      ...info,
      worktree: info.cwd === cwd ? null : (byPath.get(info.cwd) ?? null),
    });
  }
  rows.sort((a, b) => b.timestamp - a.timestamp);
  return rows;
}

/**
 * Rows for one project, cached so the list re-renders only when a displayed
 * field (title, message count, timestamp, streaming flag, badge) changes;
 * the store otherwise replaces its map on every event for any session.
 */
export function useSessionRows(worktrees: readonly Worktree[], cwd: string): SessionRow[] {
  const { subscribeStore, getSessions } = useSessionEventsContext();
  const cached = useRef<SessionRow[] | null>(null);
  const getSnapshot = useCallback(() => {
    const rows = buildSessionRows(getSessions(), worktrees, cwd);
    if (cached.current && sameSessionRows(cached.current, rows)) return cached.current;
    cached.current = rows;
    return rows;
  }, [getSessions, worktrees, cwd]);
  return useSyncExternalStore(subscribeStore, getSnapshot, () => EMPTY_ROWS);
}

/** True when two row lists render identically (same order and displayed fields). */
function sameSessionRows(a: readonly SessionRow[], b: readonly SessionRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.worktree !== y.worktree ||
      x.firstMessage !== y.firstMessage ||
      x.messageCount !== y.messageCount ||
      x.timestamp !== y.timestamp ||
      x.isStreaming !== y.isStreaming
    ) {
      return false;
    }
  }
  return true;
}
