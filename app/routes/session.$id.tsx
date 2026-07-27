import type {
  TextContent,
  ThinkingContent,
  AssistantMessage,
  StopReason,
} from "@earendil-works/pi-ai";
import { MessageCircle, Send, Plus, Layers, Sun, Moon } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import * as v from "valibot";

import {
  MessageEntry,
  toChatMessages,
  type ChatMessage,
  type ToolMessage,
} from "~/components/chat-message";
import { getPiServer, type PiState, type SseEvent } from "~/lib/pi-server";
import { useTheme } from "~/lib/theme-context";
import { MessageSchema } from "~/lib/validations";

import type { Route } from "./+types/session.$id";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Chat" }];
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Safe ID generator – works in all browsers and contexts */
function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Server-side loader ---
export async function loader({ params: { id: sessionId } }: Route.LoaderArgs) {
  const pi = getPiServer();
  const state = await pi.getState(sessionId);
  const messages = await pi.getMessages(sessionId);
  const models = await pi.getModels();
  return { state, messages, models };
}

// --- Server-side action ---
export async function action({ request, params: { id: sessionId } }: Route.ActionArgs) {
  const pi = getPiServer();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: "Invalid JSON body" };
  }

  const data = body as {
    intent?: string;
    message?: string;
    model?: { provider: string; modelId: string };
    thinkingLevel?: string;
    cwd?: string;
  };
  const intent = data.intent;

  if (!sessionId && intent !== "new-session") {
    return { error: "sessionId required" };
  }

  try {
    if (intent === "abort") {
      await pi.abort(sessionId);
      return { success: true };
    }

    if (intent === "prompt" || intent === "steer" || intent === "follow-up") {
      const parsed = v.safeParse(MessageSchema, body);
      if (!parsed.success) {
        return { error: "Invalid message", issues: parsed.issues };
      }

      const { message, model, thinkingLevel } = parsed.output;

      if (intent === "prompt") await pi.prompt(sessionId, message, { model, thinkingLevel });
      else if (intent === "steer") await pi.steer(sessionId, message, { model, thinkingLevel });
      else if (intent === "follow-up")
        await pi.followUp(sessionId, message, { model, thinkingLevel });

      return { success: true };
    }

    if (intent === "new-session") {
      const cwd = data.cwd;
      if (!cwd) return { error: "cwd required for new session" };
      const newSessionId = await pi.createNewSession(cwd);
      return { success: true, sessionId: newSessionId };
    }

    return { error: "Unknown intent" };
  } catch (err) {
    console.error("Action error:", err);
    return { error: String(err) };
  }
}

/** Extract text content from an AssistantMessage content array */
function extractTextContent(content: AssistantMessage["content"] | undefined | null): string {
  if (!content) return "";
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b: TextContent) => b.text)
    .join("\n");
}

/** Extract thinking content from an AssistantMessage content array */
function extractThinkingContent(
  content: AssistantMessage["content"] | undefined | null,
): string | undefined {
  if (!content) return undefined;
  const thinking = content
    .filter((b): b is ThinkingContent => b.type === "thinking")
    .map((b: ThinkingContent) => b.thinking)
    .join("\n");
  return thinking || undefined;
}

/** Find the index of a tool message by its toolCallId */
function findToolIndex(messages: ChatMessage[], toolCallId: string): number {
  return messages.findIndex((m) => m.role === "tool" && m.toolCallId === toolCallId);
}

function handlePiEvent(
  event: Exclude<SseEvent, { type: "internal:state" }>,
): React.SetStateAction<ChatMessage[]> {
  switch (event.type) {
    case "message_start": {
      return (prev) => [...prev, { id: uid(), role: "assistant", content: "", isStreaming: true }];
    }
    case "message_update": {
      const msgEvent = event.assistantMessageEvent;

      // text_delta / thinking_delta: accumulate streaming content
      if (msgEvent.type === "text_delta") {
        return (prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, content: last.content + msgEvent.delta };
            return updated;
          }
          return prev;
        };
      }

      if (msgEvent.type === "thinking_delta") {
        return (prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              thinking: (last.thinking || "") + msgEvent.delta,
            };
            return updated;
          }
          return prev;
        };
      }

      // done / error: finalise the assistant message with full content and error info
      if (msgEvent.type === "done" || msgEvent.type === "error") {
        const finalMessage = msgEvent.type === "done" ? msgEvent.message : msgEvent.error;
        const finalContent = extractTextContent(finalMessage?.content);
        const finalThinking = extractThinkingContent(finalMessage?.content);
        const stopReason = finalMessage?.stopReason;
        const errorMessage = finalMessage?.errorMessage;

        return (prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              content: finalContent || last.content,
              thinking: finalThinking || last.thinking,
              isStreaming: false,
              stopReason,
              errorMessage,
            };
            return updated;
          }
          return prev;
        };
      }

      // text_end / thinking_end: ignore — content already accumulated via deltas
      if (
        msgEvent.type === "text_end" ||
        msgEvent.type === "thinking_end" ||
        msgEvent.type === "text_start" ||
        msgEvent.type === "thinking_start" ||
        msgEvent.type === "toolcall_start" ||
        msgEvent.type === "toolcall_delta" ||
        msgEvent.type === "toolcall_end"
      ) {
        return (prev) => prev;
      }

      // start event: ignore, first message_update with content will follow
      if (msgEvent.type === "start") {
        return (prev) => prev;
      }

      msgEvent satisfies never;
      return (prev) => prev;
    }
    case "message_end": {
      // If we haven't seen done/error yet (e.g. empty response), finalise streaming here
      return (prev) =>
        prev.map((m) =>
          (m.role === "assistant" || m.role === "tool") && m.isStreaming
            ? { ...m, isStreaming: false }
            : m,
        );
    }
    case "tool_execution_start": {
      return (prev) => [
        ...prev,
        {
          id: uid(),
          role: "tool",
          content: `Running ${event.toolName}...`,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          toolArgs: event.args,
          isStreaming: true,
        },
      ];
    }
    case "tool_execution_update": {
      const partialResult = (event as { partialResult?: { content?: { text?: string }[] } })
        .partialResult;
      const text = partialResult?.content?.[0]?.text ?? "";

      return (prev) => {
        const idx = findToolIndex(prev, event.toolCallId);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = { ...(updated[idx] as ToolMessage), content: text };
        return updated;
      };
    }
    case "tool_execution_end": {
      const result = (event as { result?: { content?: { text?: string }[] } }).result;
      const resultText = result?.content?.[0]?.text ?? "";

      return (prev) => {
        const idx = findToolIndex(prev, event.toolCallId);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = {
          ...(updated[idx] as ToolMessage),
          content: resultText,
          isStreaming: false,
          isError: event.isError,
        };
        return updated;
      };
    }
    case "turn_end":
    case "agent_settled": {
      return (prev) =>
        prev.map((m) =>
          (m.role === "assistant" || m.role === "tool") && m.isStreaming
            ? { ...m, isStreaming: false }
            : m,
        );
    }
    case "agent_end": {
      // Extract error info from the final messages
      let stopReason: StopReason = "stop";
      let errorMessage: string | undefined;
      if (event.messages) {
        for (let i = event.messages.length - 1; i >= 0; i--) {
          const msg = event.messages[i];
          if (msg.role === "assistant") {
            stopReason = msg.stopReason;
            errorMessage = msg.errorMessage;
            break;
          }
        }
      }

      return (prev) => {
        let updated = [...prev];

        // If the last assistant message is still streaming, finalise it with error info
        if (updated.length > 0) {
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && last.isStreaming) {
            updated[updated.length - 1] = {
              ...last,
              isStreaming: false,
              stopReason,
              ...(errorMessage ? { errorMessage } : {}),
            };
          }
        }

        // Close any remaining streaming messages (tool, assistant)
        return updated.map((m) =>
          (m.role === "assistant" || m.role === "tool") && m.isStreaming
            ? { ...m, isStreaming: false }
            : m,
        );
      };
    }
    case "agent_start":
    case "auto_retry_start":
    case "auto_retry_end":
    case "compaction_start":
    case "compaction_end":
    case "entry_appended":
    case "queue_update":
    case "session_info_changed":
    case "summarization_retry_scheduled":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
    case "thinking_level_changed":
    case "turn_start": {
      // unimplemented
      return (prev) => prev;
    }
    default: {
      event satisfies never;
      console.error("Unhandled SSE event type:", (event as { type: string }).type);
      return (prev) => prev;
    }
  }
}

// --- Component ---
export default function Chat({ params: { id: sessionId } }: Route.ServerComponentProps) {
  const { theme, toggleTheme } = useTheme();
  const { state: loaderState, messages: loaderMessages, models } = useLoaderData<typeof loader>();

  const [state, setState] = useState<PiState | null>(loaderState);
  const [messages, setMessages] = useState<ChatMessage[]>(toChatMessages(loaderMessages));
  const [input, setInput] = useState("");
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [connected, setConnected] = useState(false);

  // Local model/thinking selection — applied on prompt submit
  const [selectedModel, setSelectedModel] = useState<{ provider: string; modelId: string } | null>(
    loaderState?.model
      ? { provider: loaderState.model.provider, modelId: loaderState.model.id }
      : null,
  );
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState<string>(
    loaderState?.thinkingLevel ?? "medium",
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetcher = useFetcher();
  const navigate = useNavigate();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Reset local state when navigating to a different session.
  // Only depend on sessionId so that loader re-validation after actions
  // doesn't overwrite SSE-streamed messages.
  useEffect(() => {
    setState(loaderState);
    setMessages(toChatMessages(loaderMessages));
    setInput("");
    setShowModelSelector(false);
    setSelectedModel(
      loaderState?.model
        ? { provider: loaderState.model.provider, modelId: loaderState.model.id }
        : null,
    );
    setSelectedThinkingLevel(loaderState?.thinkingLevel ?? "medium");
  }, [sessionId]);

  // Connect SSE for real-time updates
  useEffect(() => {
    function connectSSE() {
      eventSourceRef.current?.close();
      const es = new EventSource(`/session/${encodeURIComponent(sessionId)}/events`);
      eventSourceRef.current = es;

      es.onopen = () => {
        console.log("SSE connected");
        setConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SseEvent;

          // Filter events for this session
          if (data.sessionId && data.sessionId !== sessionId) return;

          if (data.type === "internal:state") {
            setState(data);
            if (data.model) {
              setSelectedModel({ provider: data.model.provider, modelId: data.model.id });
            }
            setSelectedThinkingLevel(data.thinkingLevel);
            if (data.sessionId && data.sessionId !== sessionId) {
              window.history.replaceState(
                null,
                "",
                `/session/${encodeURIComponent(data.sessionId)}`,
              );
            }
            return;
          }

          setMessages(handlePiEvent(data));
        } catch (err) {
          console.warn("SSE parse error:", err);
        }
      };

      es.onerror = () => {
        console.warn("SSE connection error, reconnecting in 3s");
        setConnected(false);
        es.close();
        reconnectTimerRef.current = setTimeout(connectSSE, 3000);
      };
    }

    connectSSE();

    return () => {
      eventSourceRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [sessionId]);

  function sendMessage() {
    const text = input.trim();
    if (!text || state?.isStreaming) return;
    setInput("");
    setMessages((prev) => [...prev, { id: uid(), role: "user", content: text }]);

    const body: {
      intent: string;
      message: string;
      model?: { provider: string; modelId: string };
      thinkingLevel?: string;
    } = {
      intent: "prompt",
      message: text,
    };
    if (selectedModel) {
      body.model = { provider: selectedModel.provider, modelId: selectedModel.modelId };
    }
    if (selectedThinkingLevel) {
      body.thinkingLevel = selectedThinkingLevel;
    }

    void fetcher.submit(body, {
      method: "post",
      encType: "application/json",
    });
  }

  function abortMessage() {
    void fetcher.submit(
      { sessionId: sessionId, intent: "abort" },
      { method: "post", encType: "application/json" },
    );
    setMessages((prev) =>
      prev.map((m) =>
        (m.role === "assistant" || m.role === "tool") && m.isStreaming
          ? { ...m, isStreaming: false }
          : m,
      ),
    );
  }

  function selectModel(provider: string, modelId: string) {
    setSelectedModel({ provider, modelId });
    setShowModelSelector(false);
  }

  function cycleThinking() {
    const currentIdx = THINKING_LEVELS.indexOf(
      (selectedThinkingLevel ||
        state?.thinkingLevel ||
        "medium") as (typeof THINKING_LEVELS)[number],
    );
    const nextIdx = (currentIdx + 1) % THINKING_LEVELS.length;
    setSelectedThinkingLevel(THINKING_LEVELS[nextIdx]);
  }

  function newSessionFromChat() {
    if (!state?.cwd) return;
    void fetcher.submit(
      { intent: "new-session", cwd: state.cwd },
      { method: "post", encType: "application/json" },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const fetcherData = fetcher.data as
    | { success?: boolean; sessionId?: string; error?: string }
    | undefined;

  // Navigate after new session created (fetcher action returns data, not redirect).
  // Reset fetcher after navigation so stale data doesn't trigger re-navigation on back.
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcherData?.sessionId &&
      fetcherData?.sessionId !== sessionId
    ) {
      const next = fetcherData.sessionId;
      fetcher.reset();
      void navigate(`/session/${encodeURIComponent(next)}`);
    }
  }, [fetcher.state, fetcherData?.sessionId, navigate, sessionId]);

  const hasModel = state?.model != null;
  const hasCwd = state?.cwd != null && state.cwd !== "";
  return (
    <div className="h-[100dvh] flex flex-col">
      {/* Top bar — fixed at top */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <Layers className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-gray-900 dark:text-gray-100">Chat</span>
          <div className="flex items-center gap-2 ml-4">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="ml-auto">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {/* Secondary toolbar */}
        <div className="max-w-5xl mx-auto px-4 h-10 flex items-center gap-2 border-t border-gray-100 dark:border-gray-800">
          {hasModel && (
            <>
              <button
                onClick={() => setShowModelSelector(!showModelSelector)}
                className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                {selectedModel
                  ? (models.find(
                      (m) =>
                        m.provider === selectedModel.provider && m.id === selectedModel.modelId,
                    )?.name ?? selectedModel.modelId)
                  : (state?.model?.name ?? "Select Model")}
              </button>
              <button
                onClick={cycleThinking}
                className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors capitalize"
              >
                {selectedThinkingLevel}
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {state?.isStreaming && (
              <button
                onClick={abortMessage}
                className="text-xs px-2.5 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
              >
                Abort
              </button>
            )}
            <button
              onClick={newSessionFromChat}
              className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          </div>
        </div>
      </div>

      {/* Model selector dropdown */}
      {showModelSelector && (
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
          <h3 className="text-sm font-medium mb-2">Select Model</h3>
          {models.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No models available. Configure API keys via environment variables or Pi's auth.json.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
              {models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => selectModel(m.provider, m.id)}
                  className={`text-left px-3 py-2 rounded-lg text-sm transition-colors border ${
                    selectedModel?.provider === m.provider && selectedModel?.modelId === m.id
                      ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700"
                      : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <p className="font-medium truncate">{m.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{m.provider}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {fetcherData?.error && (
        <div className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-6 py-2">
          <p className="text-sm text-red-700 dark:text-red-300">{fetcherData.error}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 w-full">
        <div className="max-w-5xl mx-auto px-4 py-4 space-y-4 min-h-full">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <MessageCircle
                className="w-16 h-16 mb-4 text-gray-300 dark:text-gray-600"
                strokeWidth={1.5}
              />
              <p className="text-gray-500 dark:text-gray-400 mb-2">
                {!hasModel
                  ? "No model configured. Set ANTHROPIC_API_KEY or other API key environment variable."
                  : "Send a message to start chatting with Pi"}
              </p>
            </div>
          ) : (
            messages.map((msg) => <MessageEntry key={msg.id} msg={msg} />)
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input — fixed at bottom */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex items-end gap-3 max-w-5xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              state?.isStreaming
                ? "Pi is thinking..."
                : "Type a message... (Shift+Enter for newline)"
            }
            disabled={state?.isStreaming || !hasCwd}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || state?.isStreaming || !hasCwd}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-xl p-3 transition-colors disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
