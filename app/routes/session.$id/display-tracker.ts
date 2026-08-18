/**
 * Pure decision helpers for the chat viewport display tracker. Keeping them
 * here (instead of inline in the route) makes the reporting semantics
 * testable without a browser: the newest visible message wins, off-screen
 * messages never count, and the cursor only ever moves forward.
 */

export interface DisplayObservation {
  key: string | null;
  intersecting: boolean;
}

/**
 * The key to report from one IntersectionObserver callback: the greatest
 * currently-intersecting key in the rendered message order that is forward
 * of the local cursor. Returns null when nothing visible is worth reporting
 * (nothing intersected, or everything visible is at or behind the cursor).
 */
export function selectReportedKey(
  observations: readonly DisplayObservation[],
  keys: readonly string[],
  cursor: string | null,
): string | null {
  let best: string | null = null;
  let bestIndex = -1;
  for (const observation of observations) {
    if (!observation.intersecting || observation.key == null) continue;
    const index = keys.indexOf(observation.key);
    // Unknown keys (rendered elements the reducer has not mapped yet) are
    // skipped rather than reported.
    if (index === -1 || index <= bestIndex) continue;
    bestIndex = index;
    best = observation.key;
  }
  if (best == null) return null;
  if (cursor != null) {
    const cursorIndex = keys.indexOf(cursor);
    // A stale observation at or behind the cursor never regresses it.
    if (cursorIndex !== -1 && bestIndex <= cursorIndex) return null;
  }
  return best;
}

/**
 * True when `candidate` is newer than `cursor` in the current message order.
 * Used at flush time so a report that became stale while the debounce timer
 * was pending is dropped instead of submitted redundantly.
 */
export function isForwardKey(
  candidate: string | null,
  keys: readonly string[],
  cursor: string | null,
): boolean {
  if (candidate == null) return false;
  const candidateIndex = keys.indexOf(candidate);
  if (candidateIndex === -1) return false;
  if (cursor == null) return true;
  const cursorIndex = keys.indexOf(cursor);
  return cursorIndex === -1 || candidateIndex > cursorIndex;
}
