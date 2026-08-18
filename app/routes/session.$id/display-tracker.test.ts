import { describe, expect, it } from "vitest";

import { isForwardKey, selectReportedKey } from "./display-tracker";

const KEYS = ["user:0", "assistant:0", "user:1", "assistant:1"];

function obs(key: string | null, intersecting: boolean) {
  return { key, intersecting };
}

describe("selectReportedKey", () => {
  it("marks the newest visible message when multiple messages intersect", () => {
    expect(
      selectReportedKey(
        [obs("user:0", true), obs("assistant:0", true), obs("user:1", true)],
        KEYS,
        null,
      ),
    ).toBe("user:1");
  });

  it("ignores off-screen messages entirely", () => {
    // The newest message is present but not intersecting: it must not be
    // reported as displayed.
    expect(selectReportedKey([obs("assistant:1", false)], KEYS, null)).toBeNull();
    expect(selectReportedKey([obs("user:0", true), obs("assistant:1", false)], KEYS, null)).toBe(
      "user:0",
    );
  });

  it("ignores untracked elements (no data-message-key)", () => {
    expect(selectReportedKey([obs(null, true)], KEYS, null)).toBeNull();
  });

  it("never reports a key older than or equal to the local cursor", () => {
    // The user scrolls upward: assistant:1 (already reported) is visible
    // again, but the cursor must not regress.
    expect(selectReportedKey([obs("assistant:1", true)], KEYS, "assistant:1")).toBeNull();
    expect(
      selectReportedKey([obs("user:1", true), obs("assistant:1", true)], KEYS, "assistant:1"),
    ).toBeNull();
  });

  it("only reports strictly newer keys in the message order", () => {
    expect(selectReportedKey([obs("assistant:1", true)], KEYS, "user:1")).toBe("assistant:1");
    expect(selectReportedKey([obs("assistant:1", true)], KEYS, null)).toBe("assistant:1");
  });

  it("skips keys that are not part of the current projection", () => {
    // A stale element (removed by compaction on the server) has no position
    // in the client's order: it is never reported.
    expect(selectReportedKey([obs("user:99", true)], KEYS, null)).toBeNull();
  });
});

describe("isForwardKey", () => {
  it("is true for keys with no cursor and any known key", () => {
    expect(isForwardKey("user:0", KEYS, null)).toBe(true);
    expect(isForwardKey(null, KEYS, null)).toBe(false);
    expect(isForwardKey("user:99", KEYS, null)).toBe(false);
  });

  it("is false at or behind the cursor", () => {
    expect(isForwardKey("assistant:1", KEYS, "assistant:1")).toBe(false);
    expect(isForwardKey("user:1", KEYS, "assistant:1")).toBe(false);
  });

  it("is true only beyond the cursor in the message order", () => {
    expect(isForwardKey("assistant:1", KEYS, "user:1")).toBe(true);
  });
});
