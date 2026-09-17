import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { toSessionActivityEvent } from "./pi-session-event-adapter";

describe("toSessionActivityEvent", () => {
  it("copies state events into the application event contract", () => {
    const event: AgentSessionEvent = { type: "thinking_level_changed", level: "high" };

    const result = toSessionActivityEvent(event);

    expect(result).toEqual(event);
    expect(result).not.toBe(event);
  });

  it("preserves the accumulated message carried by an update", () => {
    const message = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Hello" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: 10,
    };
    const event: AgentSessionEvent = {
      type: "message_update",
      message,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Hello",
        partial: message,
      },
    };

    expect(toSessionActivityEvent(event)).toEqual(event);
  });
});
