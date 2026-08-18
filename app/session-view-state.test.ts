import { describe, expect, it } from "vitest";

import { SessionViewStateRepository } from "./session-view-state";

describe("SessionViewStateRepository", () => {
  it("starts empty", () => {
    const repo = new SessionViewStateRepository();
    expect(repo.get("s1")).toBeNull();
    expect(repo.entries()).toEqual([]);
  });

  it("stores the cursor for a session", () => {
    const repo = new SessionViewStateRepository();
    const state = repo.set("s1", "assistant:100");
    expect(state).toEqual({
      sessionId: "s1",
      lastDisplayedMessageKey: "assistant:100",
    });
    expect(repo.get("s1")?.lastDisplayedMessageKey).toBe("assistant:100");
  });

  it("overwrites the cursor on repeated updates", () => {
    const repo = new SessionViewStateRepository();
    repo.set("s1", "assistant:10");
    repo.set("s1", "assistant:20");
    expect(repo.get("s1")?.lastDisplayedMessageKey).toBe("assistant:20");
    expect(repo.entries()).toHaveLength(1);
  });

  it("stores a null cursor as an unread marker", () => {
    const repo = new SessionViewStateRepository();
    repo.set("s1", null);
    expect(repo.get("s1")).toEqual({
      sessionId: "s1",
      lastDisplayedMessageKey: null,
    });
    // A displayed message replaces the marker.
    repo.set("s1", "assistant:1");
    expect(repo.get("s1")?.lastDisplayedMessageKey).toBe("assistant:1");
  });

  it("deletes one session's state without affecting another", () => {
    const repo = new SessionViewStateRepository();
    repo.set("a", "assistant:1");
    repo.set("b", "assistant:2");

    repo.delete("a");
    expect(repo.get("a")).toBeNull();
    expect(repo.get("b")?.lastDisplayedMessageKey).toBe("assistant:2");
  });

  it("treats deleting an unknown session as a no-op", () => {
    const repo = new SessionViewStateRepository();
    repo.set("a", "assistant:1");
    repo.delete("missing");
    expect(repo.get("a")?.lastDisplayedMessageKey).toBe("assistant:1");
  });

  it("is not persisted: a fresh instance starts empty", () => {
    const repo = new SessionViewStateRepository();
    repo.set("s1", "assistant:1");
    // A new instance (e.g. after a server restart) has no cursor: the session
    // is then treated as fully read until a client displays a newer message.
    expect(new SessionViewStateRepository().get("s1")).toBeNull();
  });
});
