import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { SseEvent } from "~/routes/events/loader";
import type { SessionInfo } from "~/session-info";

import { SessionEventProvider, useSessionEvents, useSessionStream } from "./session-events";

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
    ...overrides,
  };
}

function Harness({ sessionId }: { sessionId: string }) {
  const { info, connected, subscribe } = useSessionStream(sessionId);
  const { sessions } = useSessionEvents();
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => subscribe((event) => setEvents((prev) => [...prev, event.type])), [subscribe]);
  return (
    <div>
      <p data-testid="connected">{String(connected)}</p>
      <p data-testid="info">{info ? JSON.stringify(info) : "null"}</p>
      <p data-testid="events">{events.join(",")}</p>
      <p data-testid="sessions">{JSON.stringify([...sessions.keys()])}</p>
    </div>
  );
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
    const screen = await render(
      <SessionEventProvider>
        <Harness sessionId="s1" />
      </SessionEventProvider>,
    );

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/events");
    await expect.element(screen.getByTestId("connected")).toHaveTextContent("false");

    MockEventSource.instances[0].open();
    emit({ type: "internal:init", sessions: [info()] });

    await expect.element(screen.getByTestId("connected")).toHaveTextContent("true");
    await expect.element(screen.getByTestId("sessions")).toHaveTextContent('["s1"]');
    await expect.element(screen.getByTestId("info")).toHaveTextContent('"id":"s1"');
  });

  it("delivers session events and updates the session's info", async () => {
    const screen = await render(
      <SessionEventProvider>
        <Harness sessionId="s1" />
      </SessionEventProvider>,
    );
    MockEventSource.instances[0].open();
    emit({ type: "internal:init", sessions: [info()] });

    emit({
      type: "internal:event",
      sessionId: "s1",
      event: { type: "thinking_level_changed", level: "high" },
      info: info({ thinkingLevel: "high", isStreaming: true }),
    });

    await expect.element(screen.getByTestId("events")).toHaveTextContent("thinking_level_changed");
    await expect.element(screen.getByTestId("info")).toHaveTextContent('"thinkingLevel":"high"');
    await expect.element(screen.getByTestId("info")).toHaveTextContent('"isStreaming":true');
  });

  it("ignores events for other sessions while keeping them in the session map", async () => {
    const screen = await render(
      <SessionEventProvider>
        <Harness sessionId="s1" />
      </SessionEventProvider>,
    );
    MockEventSource.instances[0].open();
    emit({ type: "internal:init", sessions: [info()] });

    emit({
      type: "internal:event",
      sessionId: "s2",
      event: { type: "thinking_level_changed", level: "high" },
      info: info({ id: "s2" }),
    });

    await expect.element(screen.getByTestId("events")).toHaveTextContent("");
    await expect.element(screen.getByTestId("sessions")).toHaveTextContent('["s1","s2"]');
    // This session's info is untouched by the other session's event.
    await expect.element(screen.getByTestId("info")).toHaveTextContent('"id":"s1"');
  });

  it("removes sessions on internal:deleted", async () => {
    const screen = await render(
      <SessionEventProvider>
        <Harness sessionId="s1" />
      </SessionEventProvider>,
    );
    MockEventSource.instances[0].open();
    emit({ type: "internal:init", sessions: [info()] });

    emit({ type: "internal:deleted", sessionId: "s1" });

    await expect.element(screen.getByTestId("sessions")).toHaveTextContent("[]");
    await expect.element(screen.getByTestId("info")).toHaveTextContent("null");
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
    const screen = await render(
      <SessionEventProvider>
        <Harness sessionId="s1" />
      </SessionEventProvider>,
    );
    MockEventSource.instances[0].open();
    emit({ type: "internal:init", sessions: [info()] });

    vi.useFakeTimers();
    try {
      MockEventSource.instances[0].fail();
      await expect.element(screen.getByTestId("connected")).toHaveTextContent("false");
      expect(MockEventSource.instances[0].closed).toBe(true);

      vi.advanceTimersByTime(3000);
      expect(MockEventSource.instances).toHaveLength(2);

      MockEventSource.instances[1].open();
      emit({ type: "internal:init", sessions: [info({ isStreaming: true })] });
      await expect.element(screen.getByTestId("connected")).toHaveTextContent("true");
      await expect.element(screen.getByTestId("info")).toHaveTextContent('"isStreaming":true');
    } finally {
      vi.useRealTimers();
    }
  });
});
