import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

import { SessionEventProvider } from "~/contexts/session-events";
import type { SseEvent } from "~/routes/events/loader";
import type { SessionInfo } from "~/session-info";
import type { Worktree } from "~/worktree-repository";

import { buildSessionRows, useSessionRows } from "./session-list";

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

function info(
  id: string,
  cwd: string,
  timestamp: number,
  overrides: Partial<SessionInfo> = {},
): SessionInfo {
  return {
    id,
    cwd,
    name: null,
    firstMessage: `first message of ${id}`,
    messageCount: 1,
    timestamp,
    model: null,
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    ...overrides,
  };
}

const worktrees: Worktree[] = [
  { branch: "feature/x", head: null, path: "/repo/wt-feature" },
  { branch: null, head: "abc1234", path: "/repo/wt-detached" },
];

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

describe("buildSessionRows", () => {
  it("keeps only sessions of the project (root + worktrees)", () => {
    const sessions = new Map([
      ["root", info("root", "/repo", 100)],
      ["wt", info("wt", "/repo/wt-feature", 200)],
      ["other", info("other", "/elsewhere", 300)],
    ]);
    const rows = buildSessionRows(sessions, worktrees, "/repo");
    expect(rows.map((row) => row.id).sort()).toEqual(["root", "wt"]);
  });

  it("attaches the worktree by cwd and null for root sessions", () => {
    const sessions = new Map([
      ["root", info("root", "/repo", 100)],
      ["wt", info("wt", "/repo/wt-feature", 200)],
    ]);
    const rows = buildSessionRows(sessions, worktrees, "/repo");
    expect(rows.find((row) => row.id === "root")?.worktree).toBeNull();
    expect(rows.find((row) => row.id === "wt")?.worktree).toEqual(worktrees[0]);
  });

  it("sorts by timestamp descending", () => {
    const sessions = new Map([
      ["old", info("old", "/repo", 100)],
      ["new", info("new", "/repo", 300)],
      ["mid", info("mid", "/repo", 200)],
    ]);
    expect(buildSessionRows(sessions, worktrees, "/repo").map((row) => row.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("drops sessions whose cwd is a worktree deleted elsewhere", () => {
    const sessions = new Map([["gone", info("gone", "/repo/wt-removed", 100)]]);
    expect(buildSessionRows(sessions, worktrees, "/repo")).toEqual([]);
  });
});

describe("useSessionRows", () => {
  it("re-renders only when a displayed field of a visible session changes", async () => {
    const renders = { current: 0 };
    const hook = await renderHook(
      () => {
        const rows = useSessionRows(worktrees, "/repo");
        renders.current += 1;
        return rows;
      },
      { wrapper: SessionEventProvider },
    );

    await hook.act(() => {
      emit({ type: "internal:init", sessions: [info("s1", "/repo", 1000)] });
    });
    expect(hook.result.current.map((row) => `${row.id}:${row.messageCount}`).join(",")).toBe(
      "s1:1",
    );
    const baseline = renders.current;

    // An event that only changes non-displayed fields (model) must not
    // re-render the list.
    await hook.act(() => {
      emit({
        type: "internal:event",
        sessionId: "s1",
        event: { type: "thinking_level_changed", level: "high" },
        info: info("s1", "/repo", 1000, { model: { name: "m", provider: "p", id: "i" } }),
      });
    });
    expect(renders.current).toBe(baseline);

    // An event for another project's session must not re-render either.
    await hook.act(() => {
      emit({
        type: "internal:event",
        sessionId: "other",
        event: { type: "thinking_level_changed", level: "high" },
        info: info("other", "/elsewhere", 1000),
      });
    });
    expect(renders.current).toBe(baseline);

    // Changing a displayed field (message count) re-renders exactly once.
    await hook.act(() => {
      emit({
        type: "internal:event",
        sessionId: "s1",
        event: { type: "thinking_level_changed", level: "max" },
        info: info("s1", "/repo", 1000, { messageCount: 2 }),
      });
    });
    expect(renders.current).toBe(baseline + 1);
    expect(hook.result.current.map((row) => `${row.id}:${row.messageCount}`).join(",")).toBe(
      "s1:2",
    );
  });
});
