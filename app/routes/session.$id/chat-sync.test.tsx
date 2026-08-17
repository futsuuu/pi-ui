import { describe, expect, it, vi } from "vitest";
import { renderHook, type RenderHookResult } from "vitest-browser-react";

import { useChatSync, type ChatSyncOptions } from "./chat-sync";

function options(
  overrides: Partial<ChatSyncOptions> = {},
  revalidate: () => void = () => {},
): ChatSyncOptions {
  return {
    sessionId: "s1",
    connected: true,
    isStreaming: false,
    initialStreaming: false,
    hasTurnEvents: false,
    revalidatorState: "idle",
    revalidate,
    ...overrides,
  };
}

/** Mount the hook with the given options; its callback reads props directly. */
function mountChatSync(initial: ChatSyncOptions): Promise<RenderHookResult<void, ChatSyncOptions>> {
  return renderHook((props: ChatSyncOptions = initial) => useChatSync(props), {
    initialProps: initial,
  });
}

describe("useChatSync", () => {
  it("revalidates once on mount when the loader reported a streaming turn", async () => {
    const revalidate = vi.fn();
    await mountChatSync(options({ initialStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("revalidates once on mount when the loader carried turn events", async () => {
    const revalidate = vi.fn();
    await mountChatSync(options({ hasTurnEvents: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("never revalidates an idle session, even across connect flaps", async () => {
    const revalidate = vi.fn();
    const { rerender } = await mountChatSync(options({}, revalidate));
    await rerender(options({ connected: false }, revalidate));
    await rerender(options({ connected: true }, revalidate));
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("waits for the stream to connect before revalidating", async () => {
    const revalidate = vi.fn();
    const { rerender } = await mountChatSync(
      options({ connected: false, initialStreaming: true }, revalidate),
    );
    expect(revalidate).not.toHaveBeenCalled();
    await rerender(options({ connected: true, initialStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("skips while a revalidation is already in flight, then fires once", async () => {
    const revalidate = vi.fn();
    const { rerender } = await mountChatSync(
      options({ initialStreaming: true, revalidatorState: "loading" }, revalidate),
    );
    expect(revalidate).not.toHaveBeenCalled();
    await rerender(options({ initialStreaming: true, revalidatorState: "idle" }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("revalidates once on reconnect when the turn was streaming at the disconnect", async () => {
    const revalidate = vi.fn();
    // No turn at mount, so the mount revalidation is skipped.
    const { rerender } = await mountChatSync(options({}, revalidate));
    await rerender(options({ isStreaming: true }, revalidate));
    await rerender(options({ connected: false, isStreaming: true }, revalidate));
    await rerender(options({ connected: true, isStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("does not revalidate on reconnect after an idle disconnect", async () => {
    const revalidate = vi.fn();
    const { rerender } = await mountChatSync(options({ isStreaming: true }, revalidate));
    // Streaming without an outage does not consume any budget.
    expect(revalidate).not.toHaveBeenCalled();
    await rerender(options({ connected: false, isStreaming: false }, revalidate));
    await rerender(options({ connected: true, isStreaming: false }, revalidate));
    // The disconnect was idle, so the reconnect budget stays unused.
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("revalidates again on reconnect after the mount revalidation", async () => {
    const revalidate = vi.fn();
    const { rerender } = await mountChatSync(options({ initialStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1); // mount budget
    // A later turn streams through an outage: the reconnect budget, re-opened
    // by the disconnect, covers it even though the mount one is spent.
    await rerender(options({ connected: false, isStreaming: true }, revalidate));
    await rerender(options({ connected: true, isStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("revalidates on every streaming disconnect, not just once per session", async () => {
    const revalidate = vi.fn();
    const { rerender } = await mountChatSync(options({ initialStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1); // mount
    await rerender(options({ connected: false, isStreaming: true }, revalidate));
    await rerender(options({ connected: true, isStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(2); // first outage
    // A second outage in a later turn is a new loss window again.
    await rerender(options({ connected: false, isStreaming: true }, revalidate));
    await rerender(options({ connected: true, isStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(3);
  });

  it("revalidates when the turn starts right after a reconnect", async () => {
    const revalidate = vi.fn();
    const { rerender } = await mountChatSync(options({}, revalidate));
    await rerender(options({ connected: false }, revalidate));
    await rerender(options({ connected: true, isStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("never spends the mount budget from a later loader run", async () => {
    const revalidate = vi.fn();
    // Idle at mount: the budget is decided (and skipped) from the frozen
    // mount state, so a revalidation that later reports a streaming turn
    // cannot re-open it and trigger a second revalidation.
    const { rerender } = await mountChatSync(options({}, revalidate));
    expect(revalidate).not.toHaveBeenCalled();
    await rerender(options({ initialStreaming: true, isStreaming: true }, revalidate));
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("resets the guard when the session changes", async () => {
    const revalidate = vi.fn();
    const { rerender } = await mountChatSync(options({ initialStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1); // s1 mount budget
    // New session: the budgets are reset without revalidating yet.
    await rerender(options({ sessionId: "s2", initialStreaming: true }, revalidate));
    expect(revalidate).toHaveBeenCalledTimes(1);
    await rerender(options({ sessionId: "s2", connected: false, isStreaming: true }, revalidate));
    await rerender(options({ sessionId: "s2", connected: true, isStreaming: true }, revalidate));
    // s2's outage spends the fresh reconnect budget.
    expect(revalidate).toHaveBeenCalledTimes(2);
  });
});
