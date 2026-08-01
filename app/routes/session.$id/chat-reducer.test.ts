import type {
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  StopReason,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  createChatState,
  chatReducer,
  type AgentMessagePropsWithKey,
  type ChatAction,
  type ChatState,
} from "./chat-reducer";

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

function userMessage(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 1 };
}

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: StopReason,
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "mock",
    provider: "mock",
    model: "mock",
    usage: usage(),
    stopReason,
    timestamp: 1,
    ...overrides,
  };
}

function toolResultMessage(
  toolCallId: string,
  toolName: string,
  content: ToolResultMessage["content"],
  isError = false,
): ToolResultMessage {
  return { role: "toolResult", toolCallId, toolName, content, isError, timestamp: 1 };
}

function textDelta(delta: string): AssistantMessageEvent {
  // Partial messages carry the provider's placeholder stopReason ("stop" in
  // the installed 0.81.1; TODO: switch to "pending" on upgrade).
  return { type: "text_delta", contentIndex: 0, delta, partial: assistantMessage([], "stop") };
}

function thinkingDelta(delta: string): AssistantMessageEvent {
  return {
    type: "thinking_delta",
    contentIndex: 0,
    delta,
    partial: assistantMessage([], "stop"),
  };
}

const agentStart = (): AgentSessionEvent => ({ type: "agent_start" });
const turnStart = (): AgentSessionEvent => ({ type: "turn_start" });
const agentSettled = (): AgentSessionEvent => ({ type: "agent_settled" });

function messageStart(message: Message): AgentSessionEvent {
  return { type: "message_start", message };
}

function messageUpdate(
  assistantMessageEvent: AssistantMessageEvent,
  message: Message,
): AgentSessionEvent {
  return { type: "message_update", message, assistantMessageEvent };
}

function messageEnd(message: Message): AgentSessionEvent {
  return { type: "message_end", message };
}

function toolExecutionStart(
  toolCallId: string,
  toolName: string,
  args: unknown,
): AgentSessionEvent {
  return { type: "tool_execution_start", toolCallId, toolName, args };
}

function toolExecutionUpdate(toolCallId: string, partialResult: unknown): AgentSessionEvent {
  return {
    type: "tool_execution_update",
    toolCallId,
    toolName: "bash",
    args: {},
    partialResult,
  };
}

function toolExecutionEnd(
  toolCallId: string,
  result: unknown,
  isError: boolean,
): AgentSessionEvent {
  return { type: "tool_execution_end", toolCallId, toolName: "bash", result, isError };
}

function turnEnd(
  message: AssistantMessage,
  toolResults: ToolResultMessage[] = [],
): AgentSessionEvent {
  return { type: "turn_end", message, toolResults };
}

function agentEnd(messages: Message[], willRetry = false): AgentSessionEvent {
  return { type: "agent_end", messages, willRetry };
}

/**
 * Fold events through the reducer from the initial chat state. The user's own
 * message is appended by the SSE `message_start` (user) event, so every
 * connected tab sees the same conversation.
 */
function run(events: ChatAction[], eventMessages: AgentMessagePropsWithKey[] = []): ChatState {
  let state: ChatState = { loadedMessages: [], eventMessages, toolCallMap: new Map() };
  for (const event of events) {
    state = chatReducer(state, event);
  }
  return state;
}

function textBlock(text: string): { type: "text"; text: string }[] {
  return [{ type: "text", text }];
}

describe("chatReducer", () => {
  it("returns the same state reference for events it does not handle", () => {
    const state = run([]);

    expect(chatReducer(state, { type: "agent_start" })).toBe(state);
    expect(chatReducer(state, { type: "turn_start" })).toBe(state);
    expect(chatReducer(state, { type: "queue_update", steering: [], followUp: [] })).toBe(state);
  });
  it("builds the conversation from a simple streamed text turn", () => {
    const final = assistantMessage(textBlock("Hello world"), "length");
    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageUpdate(textDelta("Hello"), assistantMessage(textBlock("Hello"), "stop")),
      messageUpdate(textDelta(" world"), assistantMessage(textBlock("Hello world"), "stop")),
      messageEnd(final),
      turnEnd(final),
      agentEnd([userMessage("hello"), final]),
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    // The user message must appear exactly once (no duplicate, no empty bubble).
    expect(eventMessages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(eventMessages[0]).toMatchObject({ role: "user", content: "hello" });
    // Deltas are merged into a single text block and the real stopReason
    // from the final message is preserved (not overwritten with "stop").
    expect(eventMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Hello world" }],
      stopReason: "length",
    });
  });

  it("appends the user message from the SSE message_start event", () => {
    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageEnd(assistantMessage(textBlock("hi"), "stop")),
      turnEnd(assistantMessage(textBlock("hi"), "stop")),
      agentEnd([userMessage("hello"), assistantMessage(textBlock("hi"), "stop")]),
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(eventMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(eventMessages[1]).toMatchObject({ role: "assistant", content: textBlock("hi") });
  });

  it("renders a non-streamed assistant response from message_start/message_end", () => {
    const final = assistantMessage(textBlock("Full response"), "stop");
    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(final),
      messageEnd(final),
      turnEnd(final),
      agentEnd([userMessage("hello"), final]),
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(eventMessages[1]).toMatchObject({
      role: "assistant",
      content: textBlock("Full response"),
      stopReason: "stop",
    });
  });

  it("merges thinking deltas into a single thinking block", () => {
    const final = assistantMessage([{ type: "thinking", thinking: "let me think" }], "stop");
    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageUpdate(
        thinkingDelta("let me "),
        assistantMessage([{ type: "thinking", thinking: "let me " }], "stop"),
      ),
      messageUpdate(
        thinkingDelta("think"),
        assistantMessage([{ type: "thinking", thinking: "let me think" }], "stop"),
      ),
      messageEnd(final),
      turnEnd(final),
      agentEnd([userMessage("hello"), final]),
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "thinking", thinking: "let me think" }],
    });
  });

  it("renders exactly one tool result per executed tool call", () => {
    const toolCall: AssistantMessage["content"][number] = {
      type: "toolCall",
      id: "call-1",
      name: "bash",
      arguments: { command: "ls" },
    };
    const assistant = assistantMessage([toolCall], "toolUse");
    const result: ToolResultMessage["content"] = [{ type: "text", text: "file1\nfile2" }];
    const toolResult = toolResultMessage("call-1", "bash", result);

    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageUpdate(
        {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall,
          partial: assistantMessage([toolCall], "stop"),
        },
        assistantMessage([toolCall], "stop"),
      ),
      messageEnd(assistant),
      toolExecutionStart("call-1", "bash", { command: "ls" }),
      toolExecutionUpdate("call-1", { content: [{ type: "text", text: "partial" }], details: {} }),
      toolExecutionEnd("call-1", { content: result, details: {} }, false),
      // message_start/message_end for the toolResult must NOT append anything:
      // the placeholder already exists from tool_execution_start.
      messageStart(toolResult),
      messageEnd(toolResult),
      turnEnd(assistant, [toolResult]),
      agentEnd([userMessage("hello"), assistant, toolResult]),
      agentSettled(),
    ];

    const { eventMessages, toolCallMap } = run(events);

    expect(eventMessages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult"]);
    expect(eventMessages[1]).toMatchObject({ role: "assistant", stopReason: "toolUse" });
    expect(eventMessages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: result,
      isStreaming: false,
      isError: false,
    });
    expect(toolCallMap.get("call-1")).toEqual({ toolName: "bash", args: { command: "ls" } });
  });

  it("marks a failed tool execution as an error result", () => {
    const toolCall: AssistantMessage["content"][number] = {
      type: "toolCall",
      id: "call-1",
      name: "bash",
      arguments: { command: "false" },
    };
    const assistant = assistantMessage([toolCall], "toolUse");
    const errorText = [{ type: "text" as const, text: "command failed" }];

    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageEnd(assistant),
      toolExecutionStart("call-1", "bash", { command: "false" }),
      toolExecutionEnd("call-1", { content: errorText, details: {} }, true),
      messageStart(toolResultMessage("call-1", "bash", errorText, true)),
      messageEnd(toolResultMessage("call-1", "bash", errorText, true)),
      turnEnd(assistant, [toolResultMessage("call-1", "bash", errorText, true)]),
      agentEnd([
        userMessage("hello"),
        assistant,
        toolResultMessage("call-1", "bash", errorText, true),
      ]),
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages[2]).toMatchObject({
      role: "toolResult",
      content: errorText,
      isStreaming: false,
      isError: true,
    });
  });

  it("appends a new assistant message on a subsequent turn", () => {
    const toolCall: AssistantMessage["content"][number] = {
      type: "toolCall",
      id: "call-1",
      name: "bash",
      arguments: { command: "ls" },
    };
    const turn1Assistant = assistantMessage([toolCall], "toolUse");
    const turn2Assistant = assistantMessage(textBlock("All done"), "stop");
    const toolResult = toolResultMessage("call-1", "bash", textBlock("file1"));

    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageEnd(turn1Assistant),
      toolExecutionStart("call-1", "bash", { command: "ls" }),
      toolExecutionEnd("call-1", { content: textBlock("file1"), details: {} }, false),
      messageStart(toolResult),
      messageEnd(toolResult),
      turnEnd(turn1Assistant, [toolResult]),
      turnStart(),
      messageStart(assistantMessage([], "stop")),
      messageEnd(turn2Assistant),
      turnEnd(turn2Assistant),
      agentEnd([userMessage("hello"), turn1Assistant, toolResult, turn2Assistant]),
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    // turn_end must not clobber the first assistant's stopReason.
    expect(eventMessages[1]).toMatchObject({ role: "assistant", stopReason: "toolUse" });
    expect(eventMessages[3]).toMatchObject({
      role: "assistant",
      content: textBlock("All done"),
      stopReason: "stop",
    });
  });

  it("keeps an in-flight assistant message streaming while deltas arrive", () => {
    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageUpdate(textDelta("Hello"), assistantMessage(textBlock("Hello"), "stop")),
    ];

    const { eventMessages } = run(events);

    // Providers set a placeholder `stopReason: "stop"` on in-flight partials;
    // the UI treats `stopReason === undefined` as "still streaming", so the
    // entry must keep streaming until `message_end` closes it.
    expect(eventMessages[1]).toMatchObject({
      role: "assistant",
      content: textBlock("Hello"),
    });
    expect(
      "stopReason" in eventMessages[1] ? eventMessages[1].stopReason : undefined,
    ).toBeUndefined();
  });

  it("keeps stopReason and errorMessage from an aborted assistant message", () => {
    const aborted = assistantMessage(textBlock("partial"), "aborted", {
      errorMessage: "Operation aborted",
    });
    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageUpdate(textDelta("partial"), assistantMessage(textBlock("partial"), "stop")),
      messageEnd(aborted),
      turnEnd(aborted),
      agentEnd([userMessage("hello"), aborted], true),
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages[1]).toMatchObject({
      role: "assistant",
      stopReason: "aborted",
      errorMessage: "Operation aborted",
    });
  });

  it("finalizes an unfinished assistant message on agent_end from the run messages", () => {
    const runMessages: Message[] = [
      userMessage("hello"),
      assistantMessage(textBlock("Done"), "error", { errorMessage: "boom" }),
    ];
    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageUpdate(textDelta("Don"), assistantMessage(textBlock("Don"), "stop")),
      // No message_end for the assistant message (e.g. interrupted stream).
      agentEnd(runMessages),
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages[1]).toMatchObject({
      role: "assistant",
      stopReason: "error",
      errorMessage: "boom",
    });
  });

  it("closes unfinished streaming messages on agent_settled", () => {
    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageUpdate(textDelta("Hello"), assistantMessage(textBlock("Hello"), "stop")),
      messageEnd(assistantMessage(textBlock("Hello"), "stop")),
      toolExecutionStart("call-1", "bash", { command: "ls" }),
      // The tool never reports tool_execution_end, but the run settles anyway.
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages[1]).toMatchObject({ role: "assistant", stopReason: "stop" });
    expect(eventMessages[2]).toMatchObject({ role: "toolResult", isStreaming: false });
  });

  it("ignores session-management events without touching the messages", () => {
    const final = assistantMessage(textBlock("hi"), "stop");
    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageEnd(final),
      turnEnd(final),
      agentEnd([userMessage("hello"), final]),
      { type: "queue_update", steering: [], followUp: [] },
      {
        type: "entry_appended",
        entry: {
          type: "message",
          id: "e1",
          parentId: null,
          timestamp: "1",
          message: userMessage("hello"),
        },
      },
      { type: "session_info_changed", name: undefined },
      { type: "thinking_level_changed", level: "medium" },
      { type: "compaction_start", reason: "threshold" },
      {
        type: "compaction_end",
        reason: "threshold",
        result: undefined,
        aborted: false,
        willRetry: false,
      },
      {
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 2,
        delayMs: 100,
        errorMessage: "x",
      },
      { type: "auto_retry_end", success: true, attempt: 1 },
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    expect(eventMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("holds the user's own message in pendingUserMessage until message_start", () => {
    const pending = chatReducer(createChatState([]), { type: "user_message", content: "hello" });
    expect(pending.eventMessages).toEqual([]);
    expect(pending.pendingUserMessage).toMatchObject({ role: "user", content: "hello" });

    // The SSE message_start (user) event promotes the pending entry into
    // eventMessages and clears it, reusing the same _key so React does not
    // remount.
    const promoted = chatReducer(pending, messageStart(userMessage("hello")));
    expect(promoted.pendingUserMessage).toBeUndefined();
    expect(promoted.eventMessages).toHaveLength(1);
    expect(promoted.eventMessages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(promoted.eventMessages[0]._key).toBe(pending.pendingUserMessage?._key);
  });

  it("marks the in-flight assistant message as aborted and closes streaming tool results", () => {
    const state = run([
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageUpdate(textDelta("Hello"), assistantMessage(textBlock("Hello"), "stop")),
      toolExecutionStart("call-1", "bash", { command: "ls" }),
    ]);

    const { eventMessages } = chatReducer(state, { type: "abort" });

    expect(eventMessages[1]).toMatchObject({ role: "assistant", stopReason: "aborted" });
    expect(eventMessages[2]).toMatchObject({ role: "toolResult", isStreaming: false });
  });

  it("resets chat state, replacing the loader messages and rebuilding the toolCallMap from them", () => {
    const state = run([
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      toolExecutionStart("call-1", "bash", { command: "ls" }),
    ]);

    const withPending = chatReducer(state, { type: "user_message", content: "hello" });
    const loaded: Message[] = [
      userMessage("hello"),
      assistantMessage(
        [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } }],
        "toolUse",
      ),
    ];
    const cleared = chatReducer(withPending, { type: "reset", loadedMessages: loaded });
    expect(cleared.eventMessages).toEqual([]);
    expect(cleared.pendingUserMessage).toBeUndefined();
    expect(cleared.loadedMessages).toBe(loaded);
    // The toolCallMap is rebuilt from the loader messages, so tool summaries
    // match what is rendered (and a stale map never leaks through).
    expect(cleared.toolCallMap.get("call-1")).toEqual({
      toolName: "bash",
      args: { command: "ls" },
    });
  });
});
