import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook } from "vitest-browser-react";

import type { SseEvent } from "~/routes/events/loader";
import type { SessionInfo } from "~/session-info";

import { SessionEventProvider, useSessionEventsContext, useSessionStream } from "./session-events";

/** Minimal EventSource stand-in recording instances and exposing emit hooks. */
class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.();
  }

  emit(message: SseEvent) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  fail() {
    this.onerror?.();
  }
}

function info(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    cwd: "/tmp/cwd",
    name: null,
    firstMessage: "hello",
    messageCount: 0,
    timestamp: 0,
    model: null,
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    contextUsage: null,
    lastDisplayedMessageKey: null,
    latestMessageKey: null,
    isRead: true,
    ...overrides,
  };
}

/** Empty snapshot for the store subscription in tests (no SSR). */
const EMPTY_MAP: Map<string, SessionInfo> = new Map();

/** All sessions as a live map; re-renders on every store change. */
function useStoreSessions(): Map<string, SessionInfo> {
  const { subscribeStore, getSessions } = useSessionEventsContext();
  return useSyncExternalStore(subscribeStore, getSessions, () => EMPTY_MAP);
}

/** The stream's full observable output for one session. */
function useStreamSnapshot(sessionId = "s1") {
  const { info, viewState, connected, subscribe } = useSessionStream(sessionId);
  const sessions = useStoreSessions();
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => subscribe((event) => setEvents((prev) => [...prev, event.type])), [subscribe]);
  return { connected, info, viewState, sessions, events };
}

/** Counts effect re-runs caused by `subscribe` identity changes. */
function SubscribeStabilityHarness({ sessionId }: { sessionId: string }) {
  const { subscribe } = useSessionStream(sessionId);
  const runs = useRef(0);
  const [effectRuns, setEffectRuns] = useState(0);
  useEffect(() => {
    runs.current += 1;
    setEffectRuns(runs.current);
    return subscribe(() => {});
  }, [subscribe]);
  return <p data-testid="runs">{effectRuns}</p>;
}

/** Emit a message on the currently open connection. */
function emit(message: SseEvent) {
  MockEventSource.instances.at(-1)!.emit(message);
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SessionEventProvider", () => {
  it("connects to /events and seeds sessions from internal:init", async () => {
    const hook = await renderHook(useStreamSnapshot, {
      initialProps: "s1",
      wrapper: SessionEventProvider,
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/events");
    expect(hook.result.current.connected).toBe(false);

    await hook.act(() => {
      MockEventSource.instances[0].open();
      emit({ type: "internal:init", sessions: [info()] });
    });

    expect(hook.result.current.connected).toBe(true);
    expect([...hook.result.current.sessions.keys()]).toEqual(["s1"]);
    expect(hook.result.current.info?.id).toBe("s1");
  });

  it("delivers session events and updates the session's info", async () => {
    const hook = await renderHook(useStreamSnapshot, {
      initialProps: "s1",
      wrapper: SessionEventProvider,
    });
    await hook.act(() => {
      MockEventSource.instances[0].open();
      emit({ type: "internal:init", sessions: [info()] });
    });

    await hook.act(() => {
      emit({
        type: "internal:event",
        sessionId: "s1",
        event: { type: "thinking_level_changed", level: "high" },
        info: info({ thinkingLevel: "high", isStreaming: true }),
      });
    });

    expect(hook.result.current.events).toEqual(["thinking_level_changed"]);
    expect(hook.result.current.info?.thinkingLevel).toBe("high");
    expect(hook.result.current.info?.isStreaming).toBe(true);
  });

  it("ignores events for other sessions while keeping them in the session map", async () => {
    const hook = await renderHook(useStreamSnapshot, {
      initialProps: "s1",
      wrapper: SessionEventProvider,
    });
    await hook.act(() => {
      MockEventSource.instances[0].open();
      emit({ type: "internal:init", sessions: [info()] });
    });

    await hook.act(() => {
      emit({
        type: "internal:event",
        sessionId: "s2",
        event: { type: "thinking_level_changed", level: "high" },
        info: info({ id: "s2" }),
      });
    });

    expect(hook.result.current.events).toEqual([]);
    expect([...hook.result.current.sessions.keys()]).toEqual(["s1", "s2"]);
    // This session's info is untouched by the other session's event.
    expect(hook.result.current.info?.id).toBe("s1");
  });

  it("removes sessions on internal:deleted", async () => {
    const hook = await renderHook(useStreamSnapshot, {
      initialProps: "s1",
      wrapper: SessionEventProvider,
    });
    await hook.act(() => {
      MockEventSource.instances[0].open();
      emit({ type: "internal:init", sessions: [info()] });
    });

    await hook.act(() => {
      emit({ type: "internal:deleted", sessionId: "s1" });
    });

    expect([...hook.result.current.sessions.keys()]).toEqual([]);
    expect(hook.result.current.info).toBeNull();
  });

  it("keeps subscribe stable across connection state changes", async () => {
    const screen = await render(
      <SessionEventProvider>
        <SubscribeStabilityHarness sessionId="s1" />
      </SessionEventProvider>,
    );
    await expect.element(screen.getByTestId("runs")).toHaveTextContent("1");

    // Neither the connection toggle nor the info update may regenerate
    // `subscribe`; the effect must not re-run (and re-register) for them.
    // Wait for React to commit the updates before asserting.
    MockEventSource.instances[0].open();
    emit({ type: "internal:init", sessions: [info()] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect.element(screen.getByTestId("runs")).toHaveTextContent("1");

    MockEventSource.instances[0].fail();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect.element(screen.getByTestId("runs")).toHaveTextContent("1");
  });

  it("reconnects 3s after an error and restores info from internal:init", async () => {
    const hook = await renderHook(useStreamSnapshot, {
      initialProps: "s1",
      wrapper: SessionEventProvider,
    });
    await hook.act(() => {
      MockEventSource.instances[0].open();
      emit({ type: "internal:init", sessions: [info()] });
    });

    vi.useFakeTimers();
    try {
      await hook.act(() => {
        MockEventSource.instances[0].fail();
      });
      expect(hook.result.current.connected).toBe(false);
      expect(MockEventSource.instances[0].closed).toBe(true);

      vi.advanceTimersByTime(3000);
      expect(MockEventSource.instances).toHaveLength(2);

      await hook.act(() => {
        MockEventSource.instances[1].open();
        emit({ type: "internal:init", sessions: [info({ isStreaming: true })] });
      });
      expect(hook.result.current.connected).toBe(true);
      expect(hook.result.current.info?.isStreaming).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses the info snapshot object while the payload is unchanged", async () => {
    const changes = { current: 0 };
    function InfoStabilityHarness() {
      const { info } = useSessionStream("s1");
      const prev = useRef<SessionInfo | null | undefined>(undefined);
      useEffect(() => {
        // The mount-time null snapshot is not a payload change worth counting.
        if (prev.current === undefined) {
          prev.current = info;
          return;
        }
        if (prev.current !== info) {
          prev.current = info;
          changes.current += 1;
        }
      }, [info]);
      return null;
    }
    await render(
      <SessionEventProvider>
        <InfoStabilityHarness />
      </SessionEventProvider>,
    );

    MockEventSource.instances[0].open();
    emit({ type: "internal:init", sessions: [info({ thinkingLevel: "high" })] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes.current).toBe(1);

    // Identical info payloads: the previous snapshot object is reused, so
    // useSessionStream does not re-render (and the chat page's info-sync
    // effect does not re-run) on every streamed token.
    for (let i = 0; i < 5; i++) {
      emit({
        type: "internal:event",
        sessionId: "s1",
        event: { type: "thinking_level_changed", level: "high" },
        info: info({ thinkingLevel: "high" }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(changes.current).toBe(1);

    // A changed payload is reflected exactly once.
    emit({
      type: "internal:event",
      sessionId: "s1",
      event: { type: "thinking_level_changed", level: "max" },
      info: info({ thinkingLevel: "max" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes.current).toBe(2);
  });

  it("updates the read state from internal:view_state without touching the reducer", async () => {
    const hook = await renderHook(useStreamSnapshot, {
      initialProps: "s1",
      wrapper: SessionEventProvider,
    });
    await hook.act(() => {
      MockEventSource.instances[0].open();
      emit({
        type: "internal:init",
        sessions: [
          info({ lastDisplayedMessageKey: null, latestMessageKey: "assistant:10", isRead: false }),
        ],
      });
    });
    expect(hook.result.current.viewState).toEqual({
      lastDisplayedMessageKey: null,
      latestMessageKey: "assistant:10",
      isRead: false,
    });

    await hook.act(() => {
      emit({
        type: "internal:view_state",
        sessionId: "s1",
        viewState: {
          lastDisplayedMessageKey: "assistant:10",
          latestMessageKey: "assistant:10",
          isRead: true,
        },
      });
    });

    expect(hook.result.current.viewState).toEqual({
      lastDisplayedMessageKey: "assistant:10",
      latestMessageKey: "assistant:10",
      isRead: true,
    });
    // The dedicated event must never reach the chat reducer's subscription.
    expect(hook.result.current.events).toEqual([]);
    // The info object carries the patched read fields too.
    expect(hook.result.current.info?.isRead).toBe(true);
  });

  it("re-delivers the read state to every subscriber", async () => {
    function DualHarness() {
      const a = useSessionStream("s1");
      const b = useSessionStream("s1");
      return (
        <p
          data-testid="dual"
          data-a={a.viewState?.lastDisplayedMessageKey ?? ""}
          data-b={b.viewState?.lastDisplayedMessageKey ?? ""}
        />
      );
    }
    const screen = await render(
      <SessionEventProvider>
        <DualHarness />
      </SessionEventProvider>,
    );
    MockEventSource.instances[0].open();
    emit({ type: "internal:init", sessions: [info()] });

    emit({
      type: "internal:view_state",
      sessionId: "s1",
      viewState: {
        lastDisplayedMessageKey: "assistant:5",
        latestMessageKey: "assistant:5",
        isRead: true,
      },
    });
    await expect.element(screen.getByTestId("dual")).toHaveAttribute("data-a", "assistant:5");
    await expect.element(screen.getByTestId("dual")).toHaveAttribute("data-b", "assistant:5");
  });

  it("clears the read state when the session is deleted", async () => {
    const hook = await renderHook(useStreamSnapshot, {
      initialProps: "s1",
      wrapper: SessionEventProvider,
    });
    await hook.act(() => {
      MockEventSource.instances[0].open();
      emit({
        type: "internal:init",
        sessions: [info({ isRead: false, latestMessageKey: "assistant:10" })],
      });
    });

    await hook.act(() => {
      emit({ type: "internal:deleted", sessionId: "s1" });
    });

    expect(hook.result.current.viewState).toBeNull();
  });

  it("exposes ready only after the first internal:init and keeps it across reconnects", async () => {
    const hook = await renderHook(() => useSessionEventsContext().ready, {
      wrapper: SessionEventProvider,
    });
    expect(hook.result.current).toBe(false);

    await hook.act(() => {
      MockEventSource.instances[0].open();
      emit({ type: "internal:init", sessions: [] });
    });
    expect(hook.result.current).toBe(true);

    // A reconnect (with its own internal:init) must not reset ready: the
    // session list keeps showing the stale store instead of a loader.
    vi.useFakeTimers();
    try {
      await hook.act(() => {
        MockEventSource.instances[0].fail();
      });
      vi.advanceTimersByTime(3000);
      expect(MockEventSource.instances).toHaveLength(2);
      await hook.act(() => {
        MockEventSource.instances[1].open();
        emit({ type: "internal:init", sessions: [] });
      });
      expect(hook.result.current).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
