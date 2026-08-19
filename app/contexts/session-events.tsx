import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { SseEvent } from "~/routes/events/loader";
import type { SessionInfo } from "~/session-info";
import type { SessionReadState } from "~/session-view-state";

interface SessionEventsContextValue {
  connected: boolean;
  /** True once `internal:init` has been applied, so the store holds data. */
  ready: boolean;
  /** Latest known info for a session, or null while unknown. */
  getInfo: (sessionId: string) => SessionInfo | null;
  /** All known sessions; the map is replaced on every store update. */
  getSessions: () => Map<string, SessionInfo>;
  /** Subscribe to store updates (for useSyncExternalStore). */
  subscribeStore: (onChange: () => void) => () => void;
  /** Subscribe to one session's events. */
  subscribe: (sessionId: string, listener: (event: AgentSessionEvent) => void) => () => void;
}

const SessionEventsContext = createContext<SessionEventsContextValue | null>(null);

/** Stable empty snapshot for server rendering and the initial client state. */
const EMPTY_SESSIONS: Map<string, SessionInfo> = new Map();

interface SessionEventStore {
  sessions: Map<string, SessionInfo>;
  eventListeners: Map<string, Set<(event: AgentSessionEvent) => void>>;
  storeListeners: Set<() => void>;
}

/**
 * Provides session event data and subscriptions through a shared `/events` SSE connection.
 *
 * The connection reconnects after errors, and each reconnect reinitializes the session store
 * when the server sends `internal:init`.
 */
export function SessionEventProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const storeRef = useRef<SessionEventStore>({
    sessions: EMPTY_SESSIONS,
    eventListeners: new Map(),
    storeListeners: new Set(),
  });

  useEffect(() => {
    const store = storeRef.current;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const apply = (message: SseEvent) => {
      switch (message.type) {
        case "internal:init":
          store.sessions = new Map(message.sessions.map((info) => [info.id, info]));
          // Stays true across reconnects: the store keeps its previous data
          // until the new init replaces it, so the list must not flash a
          // loading state on every reconnect.
          setReady(true);
          break;
        case "internal:event": {
          // The server sends a fresh info object on every event, but the
          // payload only changes on user-visible transitions (model,
          // streaming flag, message count, ...). Reusing the previous object
          // when nothing consumers read changed keeps useSessionStream's
          // snapshot stable, so the chat page does not re-render (and re-run
          // its info-sync effect) on every streamed token.
          const prev = store.sessions.get(message.sessionId);
          const nextInfo = prev && sameSessionInfo(prev, message.info) ? prev : message.info;
          store.sessions = new Map(store.sessions).set(message.sessionId, nextInfo);
          for (const listener of store.eventListeners.get(message.sessionId) ?? []) {
            listener(message.event);
          }
          break;
        }
        case "internal:view_state": {
          // Read-state drift from another client: patch the session's info so
          // the store keeps a single source of truth. Never dispatched to the
          // chat reducer.
          const prev = store.sessions.get(message.sessionId);
          if (!prev) break;
          store.sessions = new Map(store.sessions).set(message.sessionId, {
            ...prev,
            lastDisplayedMessageKey: message.viewState.lastDisplayedMessageKey,
            latestMessageKey: message.viewState.latestMessageKey,
            isRead: message.viewState.isRead,
          });
          break;
        }
        case "internal:deleted": {
          const next = new Map(store.sessions);
          next.delete(message.sessionId);
          store.sessions = next;
          break;
        }
      }
      for (const listener of store.storeListeners) listener();
    };

    const connect = () => {
      es?.close();
      const source = new EventSource("/events");
      es = source;
      source.onopen = () => setConnected(true);
      source.onmessage = (message) => {
        try {
          apply(JSON.parse(message.data) as SseEvent);
        } catch (error) {
          console.warn("SSE parse error:", error);
        }
      };
      source.onerror = () => {
        setConnected(false);
        source.close();
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const subscribeStore = useCallback((onChange: () => void) => {
    storeRef.current.storeListeners.add(onChange);
    return () => storeRef.current.storeListeners.delete(onChange);
  }, []);

  const getInfo = useCallback((sessionId: string) => {
    return storeRef.current.sessions.get(sessionId) ?? null;
  }, []);

  const getSessions = useCallback(() => storeRef.current.sessions, []);

  const subscribe = useCallback(
    (sessionId: string, listener: (event: AgentSessionEvent) => void) => {
      const listeners = storeRef.current.eventListeners;
      let set = listeners.get(sessionId);
      if (!set) {
        set = new Set();
        listeners.set(sessionId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        // Only remove the map entry when it still references the captured
        // set: if a later subscriber re-created it, deleting it here would
        // drop the newer listeners silently.
        if (set.size === 0 && listeners.get(sessionId) === set) {
          listeners.delete(sessionId);
        }
      };
    },
    [],
  );

  const value = useMemo(
    () => ({ connected, ready, subscribeStore, getInfo, getSessions, subscribe }),
    [connected, ready, subscribeStore, getInfo, getSessions, subscribe],
  );

  return <SessionEventsContext value={value}>{children}</SessionEventsContext>;
}

/** Access the session events store; throws when used outside the provider. */
export function useSessionEventsContext(): SessionEventsContextValue {
  const ctx = useContext(SessionEventsContext);
  if (!ctx) throw new Error("useSessionEventsContext must be used within a SessionEventProvider");
  return ctx;
}

/**
 * Determines whether two session info objects have identical user-visible state.
 *
 * @param a - The first session info object
 * @param b - The second session info object
 * @returns `true` if both objects have identical user-visible state, `false` otherwise.
 */
function sameSessionInfo(a: SessionInfo, b: SessionInfo): boolean {
  return (
    a.cwd === b.cwd &&
    a.name === b.name &&
    a.firstMessage === b.firstMessage &&
    a.messageCount === b.messageCount &&
    a.timestamp === b.timestamp &&
    a.thinkingLevel === b.thinkingLevel &&
    a.isStreaming === b.isStreaming &&
    a.isCompacting === b.isCompacting &&
    a.lastDisplayedMessageKey === b.lastDisplayedMessageKey &&
    a.latestMessageKey === b.latestMessageKey &&
    a.isRead === b.isRead &&
    ((a.model === null && b.model === null) ||
      (a.model !== null &&
        b.model !== null &&
        a.model.name === b.model.name &&
        a.model.provider === b.model.provider &&
        a.model.id === b.model.id))
  );
}

/**
 * Extracts the read state from session information.
 *
 * @param info - The session information, or `null` when no session exists
 * @returns The session's read state, or `null` when session information is unavailable
 */
function viewStateOf(info: SessionInfo | null): SessionReadState | null {
  if (!info) return null;
  return {
    lastDisplayedMessageKey: info.lastDisplayedMessageKey,
    latestMessageKey: info.latestMessageKey,
    isRead: info.isRead,
  };
}

/**
 * Provides the current session information, read state, connection status, and event subscription for a session.
 *
 * @param sessionId - The session identifier
 * @returns The session information, read state, connection status, and session event subscription
 */
export function useSessionStream(sessionId: string) {
  const ctx = useSessionEventsContext();
  const info = useSyncExternalStore(
    ctx.subscribeStore,
    () => ctx.getInfo(sessionId),
    () => null,
  );
  const viewState = useMemo(() => viewStateOf(info), [info]);
  const subscribe = useCallback(
    (listener: (event: AgentSessionEvent) => void) => ctx.subscribe(sessionId, listener),
    [ctx.subscribe, sessionId],
  );
  return { info, viewState, connected: ctx.connected, subscribe };
}
