import { describe, expect, it, vi } from "vitest";

import { SessionEventHub } from "./session-event-hub";

describe("SessionEventHub", () => {
  it("isolates listeners and removes subscriptions", () => {
    const hub = new SessionEventHub<{ type: "event" }>();
    const listener = vi.fn();
    hub.subscribe(() => {
      throw new Error("disconnected");
    });
    const unsubscribe = hub.subscribe(listener);

    hub.publish("session-1", { type: "event" });
    unsubscribe();
    hub.publish("session-1", { type: "event" });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("session-1", { type: "event" });
  });

  it("owns independently clearable session projections", () => {
    const hub = new SessionEventHub<never>();
    const projection = hub.createProjection<number, number[]>((current, event) =>
      event === 0 ? undefined : [...(current ?? []), event].slice(-2),
    );

    projection.update(1);
    projection.update(2);
    projection.update(3);
    expect(projection.current).toEqual([2, 3]);

    projection.update(0);
    expect(projection.current).toBeUndefined();
  });

  it("clears every subscription", () => {
    const hub = new SessionEventHub<{ type: "event" }>();
    const listener = vi.fn();
    hub.subscribe(listener);

    hub.clear();
    hub.publish("session-1", { type: "event" });

    expect(listener).not.toHaveBeenCalled();
  });
});
