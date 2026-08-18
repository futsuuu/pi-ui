import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  entryKeyOf,
  foldTurnEvents,
  messageKey,
  messageKeyOf,
  orderedDisplayKeys,
  sameIdentity,
  toolResultKey,
} from "./message-key";

function usage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function user(text: string, timestamp = 1): UserMessage {
  return { role: "user", content: text, timestamp };
}

function assistant(
  content: AssistantMessage["content"],
  timestamp = 1,
  stopReason?: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "mock",
    provider: "mock",
    model: "mock",
    usage: usage(),
    ...(stopReason === undefined ? {} : { stopReason }),
    timestamp,
  } as AssistantMessage;
}

function toolResult(toolCallId: string): Extract<AgentMessage, { role: "toolResult" }> {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "bash",
    content: [{ type: "text", text: "ok" }],
    isError: false,
    timestamp: 1,
  };
}

function messageStart(message: UserMessage | AssistantMessage): AgentSessionEvent {
  return { type: "message_start", message };
}

describe("messageKey / toolResultKey", () => {
  it("builds the stable role+timestamp and toolCallId keys", () => {
    expect(messageKey("user", 123)).toBe("user:123");
    expect(messageKey("assistant", 123)).toBe("assistant:123");
    expect(toolResultKey("call-1")).toBe("toolResult:call-1");
  });

  it("does not collide between roles with the same timestamp", () => {
    expect(messageKey("user", 1000)).not.toBe(messageKey("assistant", 1000));
  });
});

describe("messageKeyOf (persisted messages)", () => {
  it("keys user and assistant messages by role + timestamp", () => {
    expect(messageKeyOf(user("hello", 5))).toBe("user:5");
    expect(messageKeyOf(assistant([{ type: "text", text: "hi" }], 6, "stop"))).toBe("assistant:6");
  });

  it("returns null for empty user messages (they render nothing)", () => {
    expect(messageKeyOf(user(""))).toBeNull();
    expect(messageKeyOf(user("   "))).toBeNull();
    // Text-less content blocks render nothing either.
    expect(messageKeyOf({ role: "user", content: [], timestamp: 1 })).toBeNull();
    expect(messageKeyOf(user("real"))).toBe("user:1");
  });

  it("never keys an in-flight assistant message (no message_end yet)", () => {
    // A finalized empty message renders nothing (stopReason set, no content).
    expect(messageKeyOf(assistant([], 1, "stop"))).toBeNull();
    // An in-flight partial renders the streaming cursor, but its content is
    // not final: it must not become a read anchor until message_end.
    expect(messageKeyOf(assistant([{ type: "text", text: "partial" }], 1))).toBeNull();
  });

  it("keys error/aborted assistant messages even without content", () => {
    const aborted: AssistantMessage = { ...assistant([], 1), stopReason: "aborted" };
    expect(messageKeyOf(aborted)).toBe("assistant:1");
    const error: AssistantMessage = {
      ...assistant([], 1),
      stopReason: "error",
      errorMessage: "boom",
    };
    expect(messageKeyOf(error)).toBe("assistant:1");
  });

  it("keys tool results by toolCallId", () => {
    expect(messageKeyOf(toolResult("call-1"))).toBe("toolResult:call-1");
  });

  it("returns null for roles the chat UI does not render", () => {
    expect(messageKeyOf({ role: "artifact", content: [] } as never)).toBeNull();
  });
});

describe("entryKeyOf (chat entries)", () => {
  it("keys entries with a timestamp and drops timestamp-less ones", () => {
    expect(entryKeyOf({ role: "user", content: "hello", timestamp: 5 })).toBe("user:5");
    // The optimistic pending user message has no timestamp yet.
    expect(entryKeyOf({ role: "user", content: "hello" })).toBeNull();
    expect(entryKeyOf({ role: "assistant", content: [{ type: "text", text: "x" }] })).toBeNull();
  });

  it("keys settled entries but never streaming ones", () => {
    // Streaming (no stopReason): rendered but not a read anchor yet.
    expect(entryKeyOf({ role: "assistant", content: [], timestamp: 5 })).toBeNull();
    expect(
      entryKeyOf({ role: "assistant", content: [{ type: "text", text: "x" }], timestamp: 5 }),
    ).toBeNull();
    // Settled (stopReason set): a read anchor.
    expect(
      entryKeyOf({ role: "assistant", content: [], timestamp: 5, stopReason: "stop" }),
    ).toBeNull(); // finalized empty: renders nothing
    expect(
      entryKeyOf({
        role: "assistant",
        content: [{ type: "text", text: "x" }],
        timestamp: 5,
        stopReason: "stop",
      }),
    ).toBe("assistant:5");
  });

  it("keys settled tool entries only (not while the tool is running)", () => {
    // Running (isStreaming): the result is not final yet.
    expect(
      entryKeyOf({ role: "toolResult", toolCallId: "call-1", content: [], isStreaming: true }),
    ).toBeNull();
    // Settled (isStreaming cleared by tool_execution_end): a read anchor.
    expect(
      entryKeyOf({ role: "toolResult", toolCallId: "call-1", content: [], isStreaming: false }),
    ).toBe("toolResult:call-1");
    expect(entryKeyOf({ role: "toolResult", toolCallId: undefined, content: [] })).toBeNull();
  });
});

describe("sameIdentity", () => {
  it("matches a persisted message with its streamed/persisted copy", () => {
    const persisted = assistant([{ type: "text", text: "final" }], 7);
    expect(sameIdentity(persisted, { role: "assistant", timestamp: 7 })).toBe(true);
    expect(sameIdentity(persisted, { role: "assistant", timestamp: 8 })).toBe(false);
  });

  it("matches tool results by toolCallId only", () => {
    const persisted = toolResult("call-1");
    expect(sameIdentity(persisted, { role: "toolResult", toolCallId: "call-1" })).toBe(true);
    expect(sameIdentity(persisted, { role: "toolResult", toolCallId: "call-2" })).toBe(false);
  });

  it("survives duplicate timestamps across roles", () => {
    const persistedUser = user("hi", 9);
    const persistedAssistant = assistant([{ type: "text", text: "hi" }], 9);
    expect(sameIdentity(persistedUser, { role: "assistant", timestamp: 9 })).toBe(false);
    expect(sameIdentity(persistedAssistant, { role: "user", timestamp: 9 })).toBe(false);
  });
});

describe("foldTurnEvents", () => {
  const textDelta = (text: string) => ({ type: "text_delta", contentIndex: 0, delta: text });

  it("coalesces message updates per identity like the reducer", () => {
    const events: AgentSessionEvent[] = [
      { type: "turn_start" },
      messageStart(user("hello", 1000)),
      messageStart(assistant([], 2000)),
      {
        type: "message_update",
        message: assistant([{ type: "text", text: "Hel" }], 2000),
        assistantMessageEvent: textDelta("Hel") as never,
      },
      {
        type: "message_update",
        message: assistant([{ type: "text", text: "Hello" }], 2000),
        assistantMessageEvent: textDelta("Hello") as never,
      },
    ];
    const folded = foldTurnEvents(events);
    expect(folded).toEqual([
      { identity: "user:1000", key: "user:1000" },
      // The assistant is still streaming (message_update, no message_end),
      // so it is not a read anchor yet.
      { identity: "assistant:2000", key: null },
    ]);
  });

  it("keeps tool events as single entries per toolCallId, settled only by the end", () => {
    const events: AgentSessionEvent[] = [
      { type: "turn_start" },
      { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: {} },
      {
        type: "tool_execution_update",
        toolCallId: "call-1",
        toolName: "bash",
        args: {},
        partialResult: { content: [{ type: "text", text: "p" }] },
      },
      {
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "done" }] },
        isError: false,
      },
    ];
    expect(foldTurnEvents(events)).toEqual([
      { identity: "toolResult:call-1", key: "toolResult:call-1" },
    ]);

    // While the tool is still running there is no read anchor yet.
    expect(
      foldTurnEvents([
        { type: "turn_start" },
        { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: {} },
      ]),
    ).toEqual([{ identity: "toolResult:call-1", key: null }]);
  });

  it("keys an in-flight assistant only after message_end settles it", () => {
    // Rendered with a streaming cursor, but not a read anchor until the end.
    expect(foldTurnEvents([messageStart(assistant([], 3000))])[0]?.key).toBeNull();
    // message_end settles it even when the final content is empty (renders
    // nothing, so still not a read anchor).
    const finalized: AgentSessionEvent = {
      type: "message_end",
      message: assistant([], 3000, "stop"),
    };
    expect(foldTurnEvents([messageStart(assistant([], 3000)), finalized])[0]?.key).toBeNull();
    // Settled with content becomes a read anchor.
    const withContent: AgentSessionEvent = {
      type: "message_end",
      message: assistant([{ type: "text", text: "done" }], 3000, "stop"),
    };
    expect(foldTurnEvents([messageStart(assistant([], 3000)), withContent])[0]?.key).toBe(
      "assistant:3000",
    );
  });

  it("folds toolResult message events into the tool identity", () => {
    const result = toolResult("call-1");
    const events: AgentSessionEvent[] = [
      messageStart(result as never),
      { type: "message_end", message: result as never },
    ];
    expect(foldTurnEvents(events)).toEqual([
      { identity: "toolResult:call-1", key: "toolResult:call-1" },
    ]);
  });
});

describe("orderedDisplayKeys", () => {
  it("orders persisted messages then settled in-flight ones, deduplicated", () => {
    const messages: AgentMessage[] = [
      user("hello", 1),
      assistant([{ type: "text", text: "hi" }], 1, "stop"),
      toolResult("call-1"),
    ];
    const turnEvents: AgentSessionEvent[] = [
      messageStart(user("hello", 1)), // already persisted: deduped
      // An in-flight assistant partial does not become a read anchor.
      { type: "message_update", message: assistant([], 2), assistantMessageEvent: null as never },
      // Its message_end settles it.
      { type: "message_end", message: assistant([{ type: "text", text: "new" }], 2, "stop") },
    ];
    expect(orderedDisplayKeys(messages, turnEvents)).toEqual([
      "user:1",
      "assistant:1",
      "toolResult:call-1",
      "assistant:2",
    ]);
  });

  it("drops messages that render nothing", () => {
    const messages: AgentMessage[] = [
      user("", 1),
      assistant([], 1, "stop"), // finalized empty
      user("real", 2),
    ];
    expect(orderedDisplayKeys(messages)).toEqual(["user:2"]);
  });

  it("returns [] for an empty conversation", () => {
    expect(orderedDisplayKeys([])).toEqual([]);
  });
});
