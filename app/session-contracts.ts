import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { SessionReadState } from "./session-view-state";

export type SessionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type SessionMessage = AgentMessage;

export interface SessionModel {
  name: string;
  provider: string;
  id: string;
}

export interface SessionModelRef {
  provider: string;
  id: string;
}

export interface SessionContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface SessionState {
  model: SessionModel | null;
  thinkingLevel: SessionThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  contextUsage: SessionContextUsage | null;
}

export interface SessionSnapshot {
  id: string;
  cwd: string;
  messages: SessionMessage[];
  state: SessionState;
}

export interface SessionListInfo {
  id: string;
  firstMessage: string;
  messageCount: number;
  timestamp: number;
}

export interface SessionInfo extends SessionListInfo, SessionState {
  cwd: string;
  name: string | null;
  lastDisplayedMessageKey: string | null;
  latestMessageKey: string | null;
  isRead: boolean;
}

export interface SessionPromptInput {
  text: string;
  model: SessionModelRef;
  thinkingLevel: SessionThinkingLevel;
}

export interface SessionLookupHints {
  cwd?: string;
  sessionDir?: string;
}

export interface SessionDeleteHints {
  cwd: string;
  sessionDir?: string;
}

type SessionToolResultContent = Extract<SessionMessage, { role: "toolResult" }>["content"];

export interface SessionToolResult {
  content?: SessionToolResultContent;
  details?: unknown;
}

export type SessionActivityEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: SessionMessage[]; willRetry: boolean }
  | { type: "agent_settled" }
  | { type: "turn_start" }
  | { type: "turn_end"; message: SessionMessage; toolResults: SessionMessage[] }
  | { type: "message_start"; message: SessionMessage }
  | {
      type: "message_update";
      message: SessionMessage;
      assistantMessageEvent: unknown;
    }
  | { type: "message_end"; message: SessionMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: SessionToolResult | undefined;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: SessionToolResult | undefined;
      isError: boolean;
    }
  | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | {
      type: "compaction_end";
      reason: "manual" | "threshold" | "overflow";
      result: unknown;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | { type: "entry_appended"; entry: unknown }
  | { type: "session_info_changed"; name: string | undefined }
  | { type: "thinking_level_changed"; level: SessionThinkingLevel }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  | {
      type: "summarization_retry_scheduled";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: "summarization_retry_attempt_start"; source: "branchSummary" }
  | {
      type: "summarization_retry_attempt_start";
      source: "compaction";
      reason: "manual" | "threshold" | "overflow";
    }
  | { type: "summarization_retry_finished" }
  | { type: "bash_execution_update"; id?: string; delta: string };

export type SessionLifecycleEvent =
  | { type: "executor_started"; generation: number }
  | { type: "executor_stopped"; generation: number; reason: "idle" | "shutdown" }
  | { type: "executor_interrupted"; generation: number; message: string };

export type SessionEvent =
  | SessionActivityEvent
  | { type: "session_deleted" }
  | { type: "view_state"; viewState: SessionReadState }
  | { type: "lifecycle"; event: SessionLifecycleEvent };

export interface SessionRepository {
  listInfo(dir: string): Promise<SessionListInfo[]>;
  findSessionCwd(sessionId: string): Promise<string | null>;
  read(sessionId: string, hints?: SessionLookupHints): Promise<SessionSnapshot | null>;
  delete(sessionId: string, hints: SessionDeleteHints): Promise<void>;
}

export interface SessionExecutor {
  start(cwd: string, input: SessionPromptInput): Promise<{ id: string }>;
  ensure(sessionId: string, hints?: SessionLookupHints): Promise<boolean>;
  snapshot(sessionId: string): Promise<SessionSnapshot | null>;
  prompt(sessionId: string, input: SessionPromptInput): Promise<void>;
  steer(sessionId: string, input: SessionPromptInput): Promise<void>;
  followUp(sessionId: string, input: SessionPromptInput): Promise<void>;
  abort(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  disposeAll(): Promise<void>;
}

export interface SessionActivitySource {
  currentInfoList(): Promise<SessionInfo[]>;
  currentInfo(sessionId: string): Promise<SessionInfo | null>;
  getTurnEvents(sessionId: string): readonly SessionActivityEvent[];
  getSessionReadState(
    sessionId: string,
    hints?: SessionLookupHints,
  ): Promise<SessionReadState | null>;
  markMessageDisplayed(
    sessionId: string,
    messageKey: string,
    hints?: SessionLookupHints,
  ): Promise<SessionReadState>;
}

export interface SessionEventHub {
  subscribe(listener: (sessionId: string, event: SessionEvent) => void): () => void;
}
