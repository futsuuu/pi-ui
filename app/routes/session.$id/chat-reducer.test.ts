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
  return { type: "text_delta", contentIndex: 0, delta, partial: assistantMessage([], "pending") };
}

function thinkingDelta(delta: string): AssistantMessageEvent {
  return {
    type: "thinking_delta",
    contentIndex: 0,
    delta,
    partial: assistantMessage([], "pending"),
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
function run(
  events: ChatAction[],
  eventMessages: AgentMessagePropsWithKey[] = [],
  sessionId: string | null = null,
): ChatState {
  let state: ChatState = {
    loadedMessages: [],
    eventMessages,
    toolCallMap: new Map(),
    sessionId,
  };
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

  it("propagates the edit tool's diff details into the tool result entry", () => {
    const editToolCall: AssistantMessage["content"][number] = {
      type: "toolCall",
      id: "call-edit",
      name: "edit",
      arguments: {
        path: "app/foo.ts",
        edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
      },
    };
    const assistant = assistantMessage([editToolCall], "toolUse");
    const details = {
      diff: " 1 const a = 1;\n-2 const b = 2;\n+2 const b = 3;",
      patch: "--- a/app/foo.ts\n+++ b/app/foo.ts",
      firstChangedLine: 2,
    };

    const events: AgentSessionEvent[] = [
      agentStart(),
      turnStart(),
      messageStart(userMessage("hello")),
      messageEnd(userMessage("hello")),
      messageStart(assistantMessage([], "stop")),
      messageEnd(assistant),
      toolExecutionStart("call-edit", "edit", editToolCall.arguments),
      toolExecutionEnd(
        "call-edit",
        { content: textBlock("Successfully replaced 1 block(s) in app/foo.ts."), details },
        false,
      ),
      turnEnd(assistant, [toolResultMessage("call-edit", "edit", textBlock("ok"))]),
      agentEnd([
        userMessage("hello"),
        assistant,
        toolResultMessage("call-edit", "edit", textBlock("ok")),
      ]),
      agentSettled(),
    ];

    const { eventMessages } = run(events);

    // ToolResultMessage renders <DiffView> from these details.
    expect(eventMessages[2]).toMatchObject({
      role: "toolResult",
      toolName: "edit",
      details,
      isStreaming: false,
      isError: false,
    });
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
    const turn2Assistant = assistantMessage(textBlock("All done"), "stop", { timestamp: 2 });
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
      // Distinct timestamp so the identity (role + timestamp) does not collide
      // with the turn-1 assistant.
      messageStart(assistantMessage([], "stop", { timestamp: 2 })),
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
      // The entry keeps its timestamp: sameIdentity later matches it against
      // the persisted message (role + timestamp) during a reset rebuild.
      timestamp: 1,
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
    const cleared = chatReducer(withPending, {
      type: "reset",
      loadedMessages: loaded,
      sessionId: null,
    });
    // Messages promoted into the snapshot are dropped; the in-flight tool
    // (not yet persisted) survives the rebuild so its stream never jumps.
    expect(cleared.eventMessages).toHaveLength(1);
    expect(cleared.eventMessages[0]).toMatchObject({
      role: "toolResult",
      toolCallId: "call-1",
      isStreaming: true,
    });
    expect(cleared.pendingUserMessage).toBeUndefined();
    expect(cleared.loadedMessages).toBe(loaded);
    // The toolCallMap is rebuilt from the loader messages, so tool summaries
    // match what is rendered (and a stale map never leaks through).
    expect(cleared.toolCallMap.get("call-1")).toEqual({
      toolName: "bash",
      args: { command: "ls" },
    });
  });

  describe("identity reconciliation (loader turnEvents and lost starts)", () => {
    it("creates the assistant entry when message_start was lost (message_update)", () => {
      // The loader snapshot carried only the user message; the assistant's
      // message_start was emitted in the [loader read -> subscription] window.
      const state = run([
        agentStart(),
        turnStart(),
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
      ]);
      const partial = assistantMessage(textBlock("Hello"), "stop", { timestamp: 5 });
      const updated = chatReducer(state, messageUpdate(textDelta("Hello"), partial));

      expect(updated.eventMessages).toHaveLength(2);
      expect(updated.eventMessages[1]).toMatchObject({
        role: "assistant",
        content: textBlock("Hello"),
      });
      const entry = updated.eventMessages[1] as Extract<
        AgentMessagePropsWithKey,
        { role: "assistant" }
      >;
      expect(entry.stopReason).toBeUndefined();
    });

    it("creates the assistant entry when message_start was lost (message_end)", () => {
      const state = run([
        agentStart(),
        turnStart(),
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
      ]);
      const final = assistantMessage(textBlock("Hello"), "stop", { timestamp: 5 });
      const ended = chatReducer(state, messageEnd(final));

      expect(ended.eventMessages).toHaveLength(2);
      expect(ended.eventMessages[1]).toMatchObject({
        role: "assistant",
        content: textBlock("Hello"),
        stopReason: "stop",
      });
    });

    it("creates the tool entry when tool_execution_start was lost", () => {
      const state = run([
        agentStart(),
        turnStart(),
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
      ]);
      const updated = chatReducer(
        state,
        toolExecutionUpdate("call-1", { content: textBlock("partial"), details: {} }),
      );
      expect(updated.eventMessages[1]).toMatchObject({
        role: "toolResult",
        toolCallId: "call-1",
        content: textBlock("partial"),
        isStreaming: true,
      });
      expect(updated.toolCallMap.get("call-1")).toEqual({ toolName: "bash", args: {} });

      const ended = chatReducer(
        updated,
        toolExecutionEnd("call-1", { content: textBlock("done"), details: {} }, false),
      );
      expect(ended.eventMessages[1]).toMatchObject({
        role: "toolResult",
        toolCallId: "call-1",
        content: textBlock("done"),
        isStreaming: false,
        isError: false,
      });
    });

    it("applies message_update to the matching assistant by identity, not the last assistant", () => {
      // Turn 1 completed; turn 2's assistant message_start was lost, so the
      // update must create a new entry instead of clobbering the finalized
      // turn-1 assistant.
      const state = run([
        agentStart(),
        turnStart(),
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
        messageStart(assistantMessage([], "stop")),
        messageUpdate(textDelta("old"), assistantMessage(textBlock("old"), "stop")),
        messageEnd(assistantMessage(textBlock("old answer"), "stop")),
        // Distinct timestamp: message identity is role + timestamp, so turn
        // 2's prompt must not collide with turn 1's.
        messageStart({ ...userMessage("second"), timestamp: 2 }),
        messageEnd({ ...userMessage("second"), timestamp: 2 }),
      ]);
      const partial = assistantMessage(textBlock("new answer"), "stop", { timestamp: 5 });
      const updated = chatReducer(state, messageUpdate(textDelta("new"), partial));

      expect(updated.eventMessages).toHaveLength(4);
      // The finalized turn-1 assistant is untouched.
      expect(updated.eventMessages[1]).toMatchObject({
        role: "assistant",
        content: textBlock("old answer"),
        stopReason: "stop",
      });
      // The new streaming assistant is created at the end.
      expect(updated.eventMessages[3]).toMatchObject({
        role: "assistant",
        content: textBlock("new answer"),
      });
    });

    it("seeds the loader's turnEvents, skipping identities already in the snapshot", () => {
      // The loader snapshot already contains the persisted conversation; the
      // buffered turn events for those messages must not append duplicates.
      const loaded: Message[] = [
        userMessage("hello"),
        assistantMessage(textBlock("final answer"), "stop"),
      ];
      const turnEvents: AgentSessionEvent[] = [
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
        messageStart(assistantMessage(textBlock("final answer"), "stop")),
        messageEnd(assistantMessage(textBlock("final answer"), "stop")),
        messageStart(assistantMessage([], "stop", { timestamp: 5 })),
        messageUpdate(
          textDelta("Hel"),
          assistantMessage(textBlock("Hel"), "stop", { timestamp: 5 }),
        ),
      ];
      const state = chatReducer(createChatState(loaded, "s1"), {
        type: "reset",
        loadedMessages: loaded,
        turnEvents,
        sessionId: "s1",
      });

      expect(state.loadedMessages).toBe(loaded);
      // Only the in-flight assistant (not in the snapshot) is seeded.
      expect(state.eventMessages).toHaveLength(1);
      expect(state.eventMessages[0]).toMatchObject({
        role: "assistant",
        content: textBlock("Hel"),
      });
    });

    it("keeps live entries not yet in the snapshot across a revalidation rebuild", () => {
      // A revalidation snapshot promotes the finalized messages; the still
      // streaming partial (same identity) stays live, and the tool in flight
      // survives.
      const loaded: Message[] = [
        userMessage("hello"),
        assistantMessage(textBlock("final answer"), "stop"),
      ];
      const before = run(
        [
          agentStart(),
          turnStart(),
          messageStart(userMessage("hello")),
          messageEnd(userMessage("hello")),
          messageStart(assistantMessage([], "stop")),
          messageUpdate(textDelta("fin"), assistantMessage(textBlock("fin"), "stop")),
          toolExecutionStart("call-1", "bash", { command: "ls" }),
        ],
        [],
        // Same session as the reset below: the kept-events path is exercised
        // (the in-flight tool survives from the live eventMessages), instead
        // of a session change that would rebuild it from turnEvents.
        "s1",
      );
      const rebuilt = chatReducer(before, {
        type: "reset",
        loadedMessages: loaded,
        turnEvents: [
          messageStart(userMessage("hello")),
          messageStart(assistantMessage(textBlock("final answer"), "stop")),
          messageEnd(assistantMessage(textBlock("final answer"), "stop")),
          toolExecutionStart("call-1", "bash", { command: "ls" }),
        ],
        sessionId: "s1",
      });

      expect(rebuilt.loadedMessages).toBe(loaded);
      // user + finalized assistant are dropped (rendered from the snapshot);
      // the in-flight tool survives the rebuild.
      expect(rebuilt.eventMessages).toHaveLength(1);
      expect(rebuilt.eventMessages[0]).toMatchObject({
        role: "toolResult",
        toolCallId: "call-1",
        isStreaming: true,
      });
      expect(rebuilt.toolCallMap.get("call-1")).toEqual({
        toolName: "bash",
        args: { command: "ls" },
      });
    });

    it("drops a finalized tool entry whose result is in the revalidation snapshot", () => {
      // The tool finished and was persisted: the revalidation snapshot now
      // carries its toolResult message. The live entry must be dropped (it is
      // rendered from the snapshot), otherwise the result renders twice. Tool
      // identity is toolCallId — the entries carry no timestamp, so the
      // role+timestamp comparison must not be used for them.
      const toolCall: AssistantMessage["content"][number] = {
        type: "toolCall",
        id: "call-1",
        name: "bash",
        arguments: { command: "ls" },
      };
      const before = run([
        agentStart(),
        turnStart(),
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
        messageStart(assistantMessage([toolCall], "toolUse")),
        messageEnd(assistantMessage([toolCall], "toolUse")),
        toolExecutionStart("call-1", "bash", { command: "ls" }),
        toolExecutionEnd("call-1", { content: textBlock("done"), details: {} }, false),
      ]);
      const loaded: Message[] = [
        userMessage("hello"),
        assistantMessage([toolCall], "toolUse"),
        toolResultMessage("call-1", "bash", textBlock("done")),
      ];
      const rebuilt = chatReducer(before, {
        type: "reset",
        loadedMessages: loaded,
        turnEvents: [],
        sessionId: "s1",
      });

      // Every message is rendered from the snapshot; nothing is kept.
      expect(rebuilt.eventMessages).toEqual([]);
    });

    it("does not double-append a user message from a seed and the live stream", () => {
      // A revalidation seed and the live SSE stream can both carry the same
      // message_start when the loader response races the delivery: the second
      // start must not render the prompt twice.
      const state = run([
        agentStart(),
        turnStart(),
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
      ]);
      const replay = chatReducer(state, messageStart(userMessage("hello")));
      expect(replay.eventMessages).toHaveLength(1);
      expect(replay.pendingUserMessage).toBeUndefined();
    });

    it("does not double-append an assistant placeholder from a seed and the live stream", () => {
      const state = run([
        agentStart(),
        turnStart(),
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
        messageStart(assistantMessage([], "stop", { timestamp: 5 })),
      ]);
      const replay = chatReducer(
        state,
        messageStart(assistantMessage([], "stop", { timestamp: 5 })),
      );
      expect(replay.eventMessages).toHaveLength(2);
      // The live partial still streams into the single entry.
      const updated = chatReducer(
        replay,
        messageUpdate(
          textDelta("Hel"),
          assistantMessage(textBlock("Hel"), "stop", { timestamp: 5 }),
        ),
      );
      expect(updated.eventMessages).toHaveLength(2);
      expect(updated.eventMessages[1]).toMatchObject({
        role: "assistant",
        content: textBlock("Hel"),
      });
    });

    it("does not double-append a tool entry from a seed and the live stream", () => {
      const state = run([
        agentStart(),
        turnStart(),
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
        toolExecutionStart("call-1", "bash", { command: "ls" }),
      ]);
      const replay = chatReducer(state, toolExecutionStart("call-1", "bash", { command: "ls" }));
      expect(replay.eventMessages).toHaveLength(2);
      expect(replay.toolCallMap.get("call-1")).toEqual({
        toolName: "bash",
        args: { command: "ls" },
      });
      // The live end still finalizes the single entry.
      const ended = chatReducer(
        replay,
        toolExecutionEnd("call-1", { content: textBlock("done"), details: {} }, false),
      );
      expect(ended.eventMessages.filter((m) => m.role === "toolResult")).toHaveLength(1);
      expect(ended.eventMessages[1]).toMatchObject({
        role: "toolResult",
        toolCallId: "call-1",
        isStreaming: false,
      });
    });

    it("clears event messages when the session changes", () => {
      // A stale (role, timestamp) from the previous session could collide
      // with a fresh event of the new session and be wrongly skipped, so a
      // session switch drops all live entries first.
      const state = run([
        agentStart(),
        turnStart(),
        messageStart(userMessage("hello")),
        messageEnd(userMessage("hello")),
        messageStart(assistantMessage([], "stop")),
        toolExecutionStart("call-1", "bash", { command: "ls" }),
      ]);
      const switched = chatReducer(state, {
        type: "reset",
        loadedMessages: [],
        turnEvents: [],
        sessionId: "s2",
      });
      expect(switched.eventMessages).toEqual([]);
      expect(switched.sessionId).toBe("s2");
    });
  });
});
