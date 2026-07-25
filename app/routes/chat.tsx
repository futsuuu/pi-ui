import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { MessageCircle, Wrench, Send, Plus, Layers, Sun, Moon } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { redirect, useFetcher, useLoaderData, useParams } from "react-router";
import * as v from "valibot";

import { getPiServer } from "~/lib/pi-server";
import { useTheme } from "~/lib/theme-context";
import { MessageSchema } from "~/lib/validations";

import type { Route } from "./+types/chat";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Chat" }];
}

// --- Types ---
interface PiState {
  cwd: string;
  model: { name: string; provider: string; id: string } | null;
  thinkingLevel: string;
  isStreaming: boolean;
  sessionId: string | null;
  messageCount: number;
  ready: boolean;
  error: string | null;
}

interface PiModel {
  id: string;
  name: string;
  provider: string;
  api: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "thinking" | "system";
  content: string;
  thinking?: string;
  toolName?: string;
  isStreaming?: boolean;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Safe ID generator – works in all browsers and contexts */
function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toChatMessage(msg: AgentMessage, index: number): ChatMessage {
  const id = `msg-${index}-${Date.now()}`;

  if (msg.role === "user") {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n");
    return { id, role: "user", content };
  }

  if (msg.role === "assistant") {
    const content = msg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const thinking =
      msg.content
        .filter((b): b is { type: "thinking"; thinking: string } => b.type === "thinking")
        .map((b) => b.thinking)
        .join("\n") || undefined;
    return { id, role: "assistant", content, thinking };
  }

  if (msg.role === "toolResult") {
    const content = msg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return {
      id: msg.toolCallId || `tool-${index}`,
      role: "tool",
      content,
      toolName: msg.toolName,
    };
  }

  // Fallback for unknown/custom message types
  return { id, role: "system", content: "" };
}

// --- Server-side loader ---
export async function loader({ params }: Route.LoaderArgs) {
  const pi = getPiServer();
  await pi.ensureInitialized();

  // If sessionId is provided in URL, switch to it
  if (params.sessionId && pi.getState().sessionId !== params.sessionId) {
    const sessions = await pi.getSessionsList();
    const match = sessions.find((s) => s.id === params.sessionId);
    if (match) {
      await pi.switchSession(match.path);
    }
  }

  const state = pi.getState();
  const messages = pi.getMessages();
  const models = await pi.getModels();

  return { state, messages, models };
}

// --- Server-side action ---
export async function action({ request }: Route.ActionArgs) {
  const pi = getPiServer();

  // Parse JSON body (sent by fetcher.submit with encType: "application/json")
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
  };
  const intent = data.intent;

  if (intent === "abort") {
    await pi.abort();
    return { success: true };
  }

  if (intent === "prompt" || intent === "steer" || intent === "follow-up") {
    const parsed = v.safeParse(MessageSchema, body);
    if (!parsed.success) {
      return { error: "Invalid message", issues: parsed.issues };
    }

    const { message, model, thinkingLevel } = parsed.output;

    if (intent === "prompt") await pi.prompt(message, { model, thinkingLevel });
    else if (intent === "steer") await pi.steer(message, { model, thinkingLevel });
    else if (intent === "follow-up") await pi.followUp(message, { model, thinkingLevel });

    return { success: true };
  }

  if (intent === "new-session") {
    await pi.newSession();
    const newSessionId = pi.getState().sessionId;
    if (newSessionId) {
      return redirect(`/chat/${encodeURIComponent(newSessionId)}`);
    }
    return { error: "Failed to create new session" };
  }

  return { error: "Unknown intent" };
}

// --- Component ---
export default function Chat() {
  const { sessionId: sessionIdFromUrl } = useParams();
  const { theme, toggleTheme } = useTheme();
  const { state: loaderState, messages: loaderMessages, models } = useLoaderData<typeof loader>();

  const [state, setState] = useState<PiState | null>(loaderState);
  const [messages, setMessages] = useState<ChatMessage[]>(
    (loaderMessages || []).map((msg, i) => toChatMessage(msg, i)),
  );
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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Connect SSE for real-time updates
  useEffect(() => {
    function connectSSE() {
      eventSourceRef.current?.close();
      const es = new EventSource("/api/pi/events");
      eventSourceRef.current = es;

      es.onopen = () => {
        console.log("SSE connected");
        setConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "pi:state") {
            const newState = data as PiState;
            setState(newState);
            if (newState.model) {
              setSelectedModel({ provider: newState.model.provider, modelId: newState.model.id });
            }
            setSelectedThinkingLevel(newState.thinkingLevel);
            if (newState.sessionId && newState.sessionId !== sessionIdFromUrl) {
              window.history.replaceState(
                null,
                "",
                `/chat/${encodeURIComponent(newState.sessionId)}`,
              );
            }
            return;
          }

          handlePiEvent(data);
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
  }, [sessionIdFromUrl]);

  function handlePiEvent(event: AgentEvent | { type: "agent_settled" }) {
    switch (event.type) {
      case "message_start": {
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: "", isStreaming: true },
        ]);
        break;
      }
      case "message_update": {
        const msgEvent = event.assistantMessageEvent;
        if (msgEvent.type === "text_delta") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, content: last.content + msgEvent.delta };
              return updated;
            }
            return prev;
          });
        }
        if (msgEvent.type === "thinking_delta") {
          setMessages((prev) => {
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
          });
        }
        if (msgEvent.type === "done" || msgEvent.type === "error") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, isStreaming: false };
              return updated;
            }
            return prev;
          });
        }
        break;
      }
      case "message_end": {
        setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
        break;
      }
      case "tool_execution_start": {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "tool",
            content: `Running ${event.toolName}...`,
            toolName: event.toolName,
            isStreaming: true,
          },
        ]);
        break;
      }
      case "tool_execution_update": {
        const partial = event.partialResult as { content?: { text?: string }[] } | undefined;
        const text = partial?.content?.[0]?.text ?? "";
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "tool" && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, content: text };
            return updated;
          }
          return prev;
        });
        break;
      }
      case "tool_execution_end": {
        const result = event.result as { content?: { text?: string }[] } | undefined;
        const resultText = result?.content?.[0]?.text ?? "";
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "tool" && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, content: resultText, isStreaming: false };
            return updated;
          }
          return prev;
        });
        break;
      }
      case "turn_end":
      case "agent_settled":
      case "agent_end": {
        setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
        break;
      }
    }
  }

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
    void fetcher.submit({ intent: "abort" }, { method: "post", encType: "application/json" });
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
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
    void fetcher.submit({ intent: "new-session" }, { method: "post", encType: "application/json" });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const hasModel = state?.model != null;
  const hasCwd = state?.cwd != null && state.cwd !== "";
  const piError = state?.error;

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
      {piError && (
        <div className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-6 py-2">
          <p className="text-sm text-red-700 dark:text-red-300">Pi Error: {piError}</p>
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
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`rounded-xl py-3 ${
                    msg.role === "user"
                      ? "max-w-[80%] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 px-4"
                      : msg.role === "tool"
                        ? "w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono text-sm border border-gray-200 dark:border-gray-700 px-4"
                        : "w-full text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {msg.toolName && msg.role === "tool" && (
                    <div className="flex items-center gap-2 mb-1 text-xs text-gray-500 dark:text-gray-400">
                      <Wrench className="w-3 h-3" />
                      <span className="font-medium">{msg.toolName}</span>
                    </div>
                  )}
                  {msg.thinking && (
                    <details className="mb-2">
                      <summary className="text-xs text-amber-600 dark:text-amber-400 cursor-pointer hover:text-amber-700 dark:hover:text-amber-300 select-none">
                        Thinking
                      </summary>
                      <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
                        {msg.thinking}
                      </div>
                    </details>
                  )}
                  <div className="whitespace-pre-wrap break-words">
                    {msg.content.trim() || (msg.isStreaming ? "..." : "")}
                    {msg.isStreaming && (
                      <span className="inline-block w-2 h-4 bg-blue-500 dark:bg-blue-400 ml-1 animate-pulse" />
                    )}
                  </div>
                </div>
              </div>
            ))
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
