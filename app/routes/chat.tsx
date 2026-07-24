import { MessageCircle, Wrench, Send, Plus, Layers, Sun, Moon } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router";

import { useTheme } from "~/lib/theme-context";

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
  // Fallback: Math.random with timestamp
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Convert an AgentMessage from the Pi SDK into our ChatMessage shape.
 * Returns a ChatMessage for ANY role (never null), so no messages are lost.
 */
function convertAgentMessage(msg: Record<string, unknown>, index: number): ChatMessage {
  const role = (msg.role as string) || "unknown";
  const rawContent = msg.content;

  // Extract text content regardless of whether it's a string or array of blocks
  const extractText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((block: Record<string, unknown>): string => {
          if (block.type === "text") return (block.text as string) ?? "";
          if (block.type === "tool_result" || block.type === "toolResult") {
            // Nested tool result content
            return extractText(block.content);
          }
          return "";
        })
        .join("\n");
    }
    return "";
  };

  // Extract thinking content from assistant messages
  const extractThinking = (content: unknown): string | undefined => {
    if (Array.isArray(content)) {
      const thinkBlocks = content.filter(
        (block: Record<string, unknown>) => block.type === "thinking",
      );
      if (thinkBlocks.length > 0) {
        return thinkBlocks
          .map((b: Record<string, unknown>) => (b.thinking as string) ?? "")
          .join("\n");
      }
    }
    return undefined;
  };

  if (role === "user") {
    return {
      id: `msg-${index}-${Date.now()}`,
      role: "user",
      content: extractText(rawContent),
    };
  }

  if (role === "assistant") {
    return {
      id: `msg-${index}-${Date.now()}`,
      role: "assistant",
      content: extractText(rawContent),
      thinking: extractThinking(rawContent),
    };
  }

  if (role === "toolResult" || role === "tool_result" || role === "tool") {
    const toolName = (msg.toolName as string) || (msg.name as string) || "tool";
    const toolCallId = (msg.toolCallId as string) || `tool-${index}`;
    return {
      id: toolCallId,
      role: "tool",
      content: extractText(rawContent),
      toolName,
    };
  }

  // Fallback: preserve any other role (system, etc.)
  return {
    id: `msg-${index}-${Date.now()}`,
    role: "system",
    content: extractText(rawContent),
  };
}

export default function Chat() {
  const navigate = useNavigate();
  const { sessionId: sessionIdFromUrl } = useParams();
  const { theme, toggleTheme } = useTheme();
  const [state, setState] = useState<PiState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<PiModel[]>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    initChat().catch(console.error);
    return () => {
      eventSourceRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  async function initChat() {
    try {
      setInitError(null);
      setLoading(true);

      // If sessionId is provided in URL, switch to it first
      if (sessionIdFromUrl) {
        try {
          // Check if we're already on the right session
          const currentState = await (await fetch("/api/pi/state")).json();
          if (currentState.sessionId !== sessionIdFromUrl) {
            // Need to find the session file for this session ID
            // List sessions to find the matching one
            const sessionsRes = await fetch("/api/pi/sessions");
            const sessionsData = await sessionsRes.json();
            const sessions = sessionsData.sessions || [];
            const matching = sessions.find((s: { id: string }) => s.id === sessionIdFromUrl);
            if (matching) {
              await fetch("/api/pi/switch-session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionPath: matching.path }),
              });
            }
          }
        } catch (e) {
          console.warn("Could not switch to session from URL:", e);
        }
      }

      // Fetch state and models in parallel
      const [stateRes, modelsRes] = await Promise.all([
        fetch("/api/pi/state"),
        fetch("/api/pi/models"),
      ]);

      if (!stateRes.ok) throw new Error(`State API returned ${stateRes.status}`);
      if (!modelsRes.ok) throw new Error(`Models API returned ${modelsRes.status}`);

      const stateData: PiState = await stateRes.json();
      const modelsData = await modelsRes.json();

      setState(stateData);
      setModels(modelsData.models || []);

      // Fetch messages
      await fetchMessages();

      // Connect SSE for real-time updates
      connectSSE();
    } catch (err) {
      console.error("Chat init error:", err);
      setInitError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function fetchMessages() {
    try {
      const res = await fetch("/api/pi/messages");
      if (!res.ok) {
        console.warn("Fetch messages returned", res.status);
        return;
      }
      const data = await res.json();
      const raw = data.messages || [];

      console.log(`Fetched ${raw.length} raw messages`);

      if (raw.length > 0) {
        const converted = raw.map(convertAgentMessage);
        console.log(`Converted ${converted.length} messages`);
        setMessages(converted);
      }
    } catch (err) {
      console.error("fetchMessages error:", err);
    }
  }

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

        // pi:state events update state and sync URL
        if (data.type === "pi:state") {
          const newState = data as PiState;
          setState(newState);
          // Sync URL with current session ID
          if (newState.sessionId && newState.sessionId !== sessionIdFromUrl) {
            window.history.replaceState(
              null,
              "",
              `/chat/${encodeURIComponent(newState.sessionId)}`,
            );
          }
          return;
        }

        // All other events are Pi SDK events
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

  function handlePiEvent(event: Record<string, unknown>) {
    switch (event.type) {
      case "message_start": {
        const msg = event.message as Record<string, unknown> | undefined;
        if (msg?.role === "assistant") {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: "assistant", content: "", isStreaming: true },
          ]);
        }
        break;
      }
      case "message_update": {
        const msgEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
        if (!msgEvent) break;
        if (msgEvent.type === "text_delta") {
          const delta = msgEvent.delta as string;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, content: last.content + delta };
              return updated;
            }
            return prev;
          });
        }
        if (msgEvent.type === "thinking_delta") {
          const delta = msgEvent.delta as string;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                thinking: (last.thinking || "") + delta,
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
              updated[updated.length - 1] = {
                ...last,
                isStreaming: false,
              };
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
        const toolName = (event.toolName as string) || "tool";
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "tool",
            content: `Running ${toolName}...`,
            toolName,
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
            updated[updated.length - 1] = {
              ...last,
              content: resultText,
              isStreaming: false,
            };
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

  async function sendMessage() {
    const text = input.trim();
    if (!text || state?.isStreaming) return;
    setInput("");
    setMessages((prev) => [...prev, { id: uid(), role: "user", content: text }]);
    try {
      const res = await fetch("/api/pi/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) console.warn("Prompt returned", res.status);
    } catch (err) {
      console.error("Send error:", err);
    }
  }

  async function abortMessage() {
    try {
      await fetch("/api/pi/abort", { method: "POST" });
      setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
    } catch {}
  }

  async function setModel(provider: string, modelId: string) {
    try {
      await fetch("/api/pi/set-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, modelId }),
      });
      setShowModelSelector(false);
    } catch {}
  }

  function cycleThinking() {
    if (!state) return;
    const currentIdx = THINKING_LEVELS.indexOf(
      state.thinkingLevel as (typeof THINKING_LEVELS)[number],
    );
    const nextIdx = (currentIdx + 1) % THINKING_LEVELS.length;
    fetch("/api/pi/set-thinking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: THINKING_LEVELS[nextIdx] }),
    }).catch(() => {});
  }

  async function newSessionFromChat() {
    try {
      const res = await fetch("/api/pi/new-session", { method: "POST" });
      const data = await res.json();
      const newSessionId = data.sessionId;
      if (newSessionId) {
        void navigate(`/chat/${encodeURIComponent(newSessionId)}`, { replace: true });
      }
      setMessages([]);
    } catch {}
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
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
                {state.model?.name ?? "Select Model"}
              </button>
              <button
                onClick={cycleThinking}
                className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors capitalize"
              >
                {state.thinkingLevel}
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
                  onClick={() => setModel(m.provider, m.id)}
                  className={`text-left px-3 py-2 rounded-lg text-sm transition-colors border ${
                    state?.model?.id === m.id
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

      {initError && (
        <div className="bg-yellow-50 dark:bg-yellow-900/30 border-b border-yellow-200 dark:border-yellow-800 px-6 py-2">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">Init Error: {initError}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 w-full">
        <div className="max-w-5xl mx-auto px-4 py-4 space-y-4 min-h-full">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-400">Loading chat...</p>
            </div>
          ) : messages.length === 0 ? (
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
                  className={`max-w-[80%] rounded-xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : msg.role === "tool"
                        ? "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono text-sm border border-gray-200 dark:border-gray-700"
                        : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100"
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
                    {msg.content || (msg.isStreaming ? "..." : "")}
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
