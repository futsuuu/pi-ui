import type { StopReason } from "@earendil-works/pi-ai";
import { Layers, MessageCircle, Moon, Plus, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import * as v from "valibot";

import { ScrollArea } from "~/components/scroll-area";
import { useTheme } from "~/contexts/theme";
import { getPiServer, type PiState, type SseEvent } from "~/lib/pi-server";
import { MessageSchema } from "~/lib/validations";

import type { Route } from "./+types/route";
import { AgentMessage, type Props as AgentMessageProps } from "./agent-message";
import { PromptForm } from "./prompt-form";
import { buildToolCallMap, ToolCallContext } from "./tool-call-context";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Chat" }];
}

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
  if (!state) throw new Response(`Session ${sessionId} not found`, { status: 404 });
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

  if (intent !== "new-session") {
    const exists = await pi.getState(sessionId);
    if (!exists) {
      throw new Response(`Session ${sessionId} not found`, { status: 404 });
    }
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

/** Find the index of a tool result message by its toolCallId */
function findToolIndex(messages: AgentMessageProps[], toolCallId: string): number {
  return messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === toolCallId);
}

type AgentMessagePropsWithKey = AgentMessageProps & { _key: string };

function handlePiEvent(event: Exclude<SseEvent, { type: "internal:state" }>): {
  messages: React.SetStateAction<AgentMessagePropsWithKey[]>;
  toolCallMap?: React.SetStateAction<Map<string, { toolName: string; args: unknown }>>;
} {
  switch (event.type) {
    case "message_start": {
      return {
        messages: (prev) => [...prev, { _key: uid(), role: "assistant", content: [] }],
      };
    }
    case "message_update": {
      const msgEvent = event.assistantMessageEvent;

      if (msgEvent.type === "text_delta") {
        return {
          messages: (prev) => {
            const last = prev[prev.length - 1];
            if (last?.role !== "assistant") return prev;
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              content: [...last.content, { type: "text", text: msgEvent.delta }],
            };
            return updated;
          },
        };
      }

      if (msgEvent.type === "thinking_delta") {
        return {
          messages: (prev) => {
            const last = prev[prev.length - 1];
            if (last?.role !== "assistant") return prev;
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              content: [...last.content, { type: "thinking", thinking: msgEvent.delta }],
            };
            return updated;
          },
        };
      }

      if (msgEvent.type === "done" || msgEvent.type === "error") {
        const finalMessage = msgEvent.type === "done" ? msgEvent.message : msgEvent.error;
        return {
          messages: (prev) => {
            const last = prev[prev.length - 1];
            if (last?.role !== "assistant") return prev;
            const updated = [...prev];
            updated[updated.length - 1] = {
              _key: last._key,
              ...finalMessage,
            };
            return updated;
          },
        };
      }

      // Sub-events that don't need UI updates
      if (
        msgEvent.type === "text_end" ||
        msgEvent.type === "thinking_end" ||
        msgEvent.type === "text_start" ||
        msgEvent.type === "thinking_start" ||
        msgEvent.type === "toolcall_start" ||
        msgEvent.type === "toolcall_delta" ||
        msgEvent.type === "toolcall_end" ||
        msgEvent.type === "start"
      ) {
        return { messages: (prev) => prev };
      }

      msgEvent satisfies never;
      return { messages: (prev) => prev };
    }
    case "message_end": {
      return {
        messages: (prev) =>
          prev.map((m) =>
            m.role === "assistant" && m.stopReason === undefined ? { ...m, stopReason: "stop" } : m,
          ),
      };
    }
    case "tool_execution_start": {
      return {
        messages: (prev) => [
          ...prev,
          {
            _key: uid(),
            role: "toolResult",
            content: [],
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            isError: false,
            isStreaming: true,
          },
        ],
        toolCallMap: (prev) =>
          new Map(prev).set(event.toolCallId, {
            toolName: event.toolName,
            args: event.args,
          }),
      };
    }
    case "tool_execution_update": {
      const partialResult = (
        event as {
          partialResult?: { content?: { type: string; text?: string }[] };
        }
      ).partialResult;
      const updateText = partialResult?.content?.[0]?.text ?? "";

      return {
        messages: (prev) => {
          const idx = findToolIndex(prev, event.toolCallId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...(updated[idx] as Extract<AgentMessagePropsWithKey, { role: "toolResult" }>),
            content: updateText ? [{ type: "text", text: updateText }] : [],
          };
          return updated;
        },
      };
    }
    case "tool_execution_end": {
      const result = (
        event as {
          result?: { content?: { type: string; text?: string }[] };
        }
      ).result;
      const resultText = result?.content?.[0]?.text ?? "";

      return {
        messages: (prev) => {
          const idx = findToolIndex(prev, event.toolCallId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...(updated[idx] as Extract<AgentMessagePropsWithKey, { role: "toolResult" }>),
            content: resultText ? [{ type: "text", text: resultText }] : [],
            isStreaming: false,
            isError: event.isError,
          };
          return updated;
        },
      };
    }
    case "turn_end":
    case "agent_settled": {
      return {
        messages: (prev) =>
          prev.map((m) =>
            m.role === "assistant" && m.stopReason === undefined
              ? { ...m, stopReason: "stop" }
              : m.role === "toolResult" && m.isStreaming
                ? { ...m, isStreaming: false }
                : m,
          ),
      };
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

      return {
        messages: (prev) => {
          let updated = [...prev];

          // If the last assistant message is still streaming, finalise it with error info
          if (updated.length > 0) {
            const last = updated[updated.length - 1];
            if (last?.role === "assistant" && last.stopReason === undefined) {
              updated[updated.length - 1] = {
                _key: last._key,
                role: "assistant",
                content: last.content,
                stopReason,
                ...(errorMessage ? { errorMessage } : {}),
              };
            }
          }

          // Close any remaining streaming messages
          return updated.map((m) =>
            m.role === "assistant" && m.stopReason === undefined
              ? { ...m, stopReason: "stop" }
              : m.role === "toolResult" && m.isStreaming
                ? { ...m, isStreaming: false }
                : m,
          );
        },
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
      return { messages: (prev) => prev };
    }
    default: {
      event satisfies never;
      console.error("Unhandled SSE event type:", (event as { type: string }).type);
      return { messages: (prev) => prev };
    }
  }
}

// --- Component ---
export default function Chat({ params: { id: sessionId } }: Route.ServerComponentProps) {
  const { theme, toggleTheme } = useTheme();
  const { state: loadedState, messages: loadedMessages, models } = useLoaderData<typeof loader>();

  const [state, setState] = useState<PiState>(loadedState);
  const [eventMessages, setEventMessages] = useState<AgentMessagePropsWithKey[]>([]);
  {
    // If the loader re-validates, event messages are now included in loader data.
    const prevLoadedMessages = useRef(loadedMessages);
    if (loadedMessages !== prevLoadedMessages.current) {
      prevLoadedMessages.current = loadedMessages;
      // Render-time setState is safe here because:
      // - it's conditional (only when loadedMessages reference changes), preventing infinite loop
      // - React applies it synchronously within the render phase, before commit
      // - this avoids race conditions with SSE events that useEffect would have
      setEventMessages([]);
    }
  }
  const [toolCallMap, setToolCallMap] = useState(() => buildToolCallMap(loadedMessages));
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Whether the user is scrolled near the bottom (within 50px threshold)
  const shouldAutoScroll = useRef(true);

  const fetcher = useFetcher();
  const navigate = useNavigate();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Track scroll position — only auto-scroll if user is at the bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 50;
    shouldAutoScroll.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Auto-scroll on new messages only when user hasn't scrolled up
  useEffect(() => {
    if (shouldAutoScroll.current) {
      scrollToBottom();
    }
  }, [eventMessages, scrollToBottom]);

  // Also scroll on initial load of session (when loadedMessages are first rendered)
  useEffect(() => {
    scrollToBottom();
    // Reset to auto-follow for this session
    shouldAutoScroll.current = true;
  }, [sessionId]);

  // Reset local state when navigating to a different session.
  // Only depend on sessionId so that loader re-validation after actions
  // doesn't overwrite SSE-streamed messages.
  useEffect(() => {
    setState(loadedState);
    setEventMessages([]);
    setToolCallMap(buildToolCallMap(loadedMessages));
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
            if (data.sessionId && data.sessionId !== sessionId) {
              window.history.replaceState(
                null,
                "",
                `/session/${encodeURIComponent(data.sessionId)}`,
              );
            }
            return;
          }

          {
            const result = handlePiEvent(data);
            setEventMessages(result.messages);
            if (result.toolCallMap) setToolCallMap(result.toolCallMap);
          }
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

  function sendMessage(
    text: string,
    model: { provider: string; modelId: string } | null,
    thinkingLevel: string,
  ) {
    setEventMessages((prev) => [...prev, { _key: uid(), role: "user", content: text }]);

    const body: {
      intent: string;
      message: string;
      model?: { provider: string; modelId: string };
      thinkingLevel?: string;
    } = {
      intent: "prompt",
      message: text,
    };
    if (model) {
      body.model = model;
    }
    if (thinkingLevel) {
      body.thinkingLevel = thinkingLevel;
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
    setEventMessages((prev) =>
      prev.map((m) =>
        m.role === "assistant" && m.stopReason === undefined
          ? { ...m, stopReason: "aborted" as const }
          : m.role === "toolResult" && m.isStreaming
            ? { ...m, isStreaming: false }
            : m,
      ),
    );
  }

  function newSessionFromChat() {
    void fetcher.submit(
      { intent: "new-session", cwd: state.cwd },
      { method: "post", encType: "application/json" },
    );
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

  const hasModel = state.model != null;

  return (
    <div className="h-full flex flex-col relative">
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

      {/* Error banner */}
      {fetcherData?.error && (
        <div className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-6 py-2">
          <p className="text-sm text-red-700 dark:text-red-300">{fetcherData.error}</p>
        </div>
      )}

      {/* Messages */}
      <ScrollArea ref={scrollContainerRef} onScroll={handleScroll} viewportClassName="pb-36">
        <div className="max-w-5xl max-lg:max-w-[100vw] w-full mx-auto px-4 py-4 space-y-4 min-h-full min-w-0">
          {loadedMessages.length === 0 && eventMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16">
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
            <ToolCallContext value={toolCallMap}>
              {loadedMessages.map((msg, index) => (
                <AgentMessage key={index} {...msg} />
              ))}
              {eventMessages.map((msg) => (
                <AgentMessage key={msg._key} {...msg} />
              ))}
            </ToolCallContext>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <PromptForm
        key={sessionId}
        isStreaming={state?.isStreaming ?? false}
        models={models}
        defaultModel={
          state.model ? { provider: state.model.provider, modelId: state.model.id } : null
        }
        defaultThinkingLevel={state.thinkingLevel ?? "medium"}
        onSend={sendMessage}
      />
    </div>
  );
}
