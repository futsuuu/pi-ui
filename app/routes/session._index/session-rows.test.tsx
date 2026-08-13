import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SessionEventProvider } from "~/contexts/session-events";
import type { SseEvent } from "~/routes/events/loader";
import type { SessionInfo } from "~/session-info";
import type { Worktree } from "~/worktree-repository";

import { useSessionRows } from "./session-list";

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

  emit(message: SseEvent) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function info(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    cwd: "/repo",
    name: null,
    firstMessage: "hello",
    messageCount: 1,
    timestamp: 1000,
    model: null,
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    ...overrides,
  };
}

const worktrees: Worktree[] = [{ branch: "feature/x", head: null, path: "/repo/wt" }];

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

describe("useSessionRows", () => {
  it("re-renders only when a displayed field of a visible session changes", async () => {
    const renders = { current: 0 };
    function Harness() {
      const rows = useSessionRows(worktrees, "/repo");
      renders.current += 1;
      return (
        <p data-testid="rows">{rows.map((row) => `${row.id}:${row.messageCount}`).join(",")}</p>
      );
    }
    const screen = await render(
      <SessionEventProvider>
        <Harness />
      </SessionEventProvider>,
    );

    emit({ type: "internal:init", sessions: [info()] });
    await expect.element(screen.getByTestId("rows")).toHaveTextContent("s1:1");
    const baseline = renders.current;

    // An event that only changes non-displayed fields (model) must not
    // re-render the list.
    emit({
      type: "internal:event",
      sessionId: "s1",
      event: { type: "thinking_level_changed", level: "high" },
      info: info({ model: { name: "m", provider: "p", id: "i" } }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renders.current).toBe(baseline);

    // An event for another project's session must not re-render either.
    emit({
      type: "internal:event",
      sessionId: "other",
      event: { type: "thinking_level_changed", level: "high" },
      info: info({ id: "other", cwd: "/elsewhere" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renders.current).toBe(baseline);

    // Changing a displayed field (message count) re-renders exactly once.
    emit({
      type: "internal:event",
      sessionId: "s1",
      event: { type: "thinking_level_changed", level: "max" },
      info: info({ messageCount: 2 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renders.current).toBe(baseline + 1);
    await expect.element(screen.getByTestId("rows")).toHaveTextContent("s1:2");
  });
});
