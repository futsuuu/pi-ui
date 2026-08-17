import { useEffect, useRef } from "react";
import type { RevalidationState } from "react-router";

export interface ChatSyncOptions {
  /** Session identity; a change resets the per-session revalidation guard. */
  sessionId: string;
  /** SSE connection state from `useSessionStream`. */
  connected: boolean;
  /** Current streaming state (the chat page's local state). */
  isStreaming: boolean;
  /** Streaming state reported by the loader at seed time. */
  initialStreaming: boolean;
  /** True when the loader carried a non-empty turn buffer. */
  hasTurnEvents: boolean;
  revalidatorState: RevalidationState;
  revalidate: () => void;
}

/**
 * The /events stream lifecycle for the chat page. Connect-state transitions
 * are applied in a committed effect: the closure captures the committed
 * render's streaming state, so the disconnect's state is recorded from the
 * commit that observed the drop (commit timing, not render timing), and an
 * abandoned render can never create a dangling disconnected/reconnected
 * state. The budgets are spent by the revalidation effect, which moves the
 * state back to `connected` after a reconnect revalidation.
 *
 * - connected: the stream is up, or the session just started (no outage has
 *   been recorded yet).
 * - disconnected: an outage; `streaming` is the streaming state at the
 *   moment the stream dropped.
 * - reconnected: the stream recovered; the reconnect budget is owed once a
 *   turn is/was streaming.
 */
type ConnectionState =
  | { status: "connected" }
  | { status: "disconnected"; streaming: boolean }
  | { status: "reconnected"; streaming: boolean };

/**
 * The mount revalidation budget, one per session: the `[loader read ->
 * subscription]` window is closed by a single revalidation, decided from the
 * loader state frozen at mount (`initialStreaming` / `hasTurnEvents`) so a
 * later loader run cannot spend it. `none` = no turn in flight at mount
 * (idle sessions render once and pay no request), `pending` = spent by the
 * first connected-and-idle effect run, `spent` = decided.
 */
type MountBudget = "none" | "pending" | "spent";

/**
 * Reconcile the chat page with the loader after a loss window:
 *
 * - mount: the loader snapshot has no in-flight partial, so a turn that was
 *   streaming at mount is re-loaded once `[loader read -> subscription]` has
 *   closed.
 * - reconnect: messages persisted while the stream was down are recovered.
 *   Every disconnect is a new loss window, so the reconnect budget is
 *   re-opened on each disconnect and spent by the next reconnect.
 *
 * `revalidatorState` and the two budgets guard the revalidations, so a
 * flapping connection cannot storm the loader.
 */
export function useChatSync({
  sessionId,
  connected,
  isStreaming,
  initialStreaming,
  hasTurnEvents,
  revalidatorState,
  revalidate,
}: ChatSyncOptions): void {
  const connectionRef = useRef<ConnectionState>({ status: "connected" });
  // Frozen at mount; later loader data must not spend the mount budget.
  const mountBudgetRef = useRef<MountBudget>(
    initialStreaming || hasTurnEvents ? "pending" : "none",
  );
  const prevSessionRef = useRef(sessionId);
  const prevConnectedRef = useRef(connected);

  // Committed session-change reset: the lifecycle and mount budget are
  // re-frozen from the committed loader state of the new session. An
  // abandoned render of an old session change cannot leave the lifecycle
  // halfway, because the reset only runs in an effect that is committed.
  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      connectionRef.current = { status: "connected" };
      mountBudgetRef.current = initialStreaming || hasTurnEvents ? "pending" : "none";
      prevConnectedRef.current = connected;
    }
  }, [sessionId, initialStreaming, hasTurnEvents, connected]);

  // Connect-state transitions, committed via an effect: a drop re-opens the
  // reconnect budget and records the streaming state at the outage; the next
  // reconnect marks the budget as owed. Runs after every commit; without a
  // transition it only re-syncs `prevConnectedRef`.
  useEffect(() => {
    if (prevConnectedRef.current && !connected) {
      connectionRef.current = { status: "disconnected", streaming: isStreaming };
    } else if (!prevConnectedRef.current && connected) {
      const connection = connectionRef.current;
      if (connection.status === "disconnected") {
        connectionRef.current = { status: "reconnected", streaming: connection.streaming };
      }
    }
    prevConnectedRef.current = connected;
  });

  // `isStreaming` is in the dependency array only to spend the reconnect
  // budget when a stream starts after the reconnect (a turn that began while
  // the stream was down).
  useEffect(() => {
    if (!connected) return;
    if (revalidatorState !== "idle") return;
    const connection = connectionRef.current;
    // Reconnect after any outage (also covers a turn that started while the
    // stream was down): recover messages persisted during the outage. The
    // budget is once per disconnect (re-opened at each drop).
    if (connection.status === "reconnected" && (connection.streaming || isStreaming)) {
      connectionRef.current = { status: "connected" };
      revalidate();
      return;
    }
    if (mountBudgetRef.current === "pending") {
      mountBudgetRef.current = "spent";
      revalidate();
    }
  }, [connected, revalidatorState, isStreaming, revalidate]);
}
