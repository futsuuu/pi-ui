import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Layers, MessageCircle, Moon, Plus, Sun } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { data, Link, useFetcher } from "react-router";

import { ScrollArea } from "~/components/scroll-area";
import { useTheme } from "~/contexts/theme";
import { agentSessionContainerContext } from "~/router-contexts";

import type { SseEvent } from "../session.$id.events/loader";
import type { Route } from "./+types/route";
import type { ActionInput, action } from "./action";
import { AgentMessage } from "./agent-message";
import { createChatState, chatReducer } from "./chat-reducer";
import { PromptForm } from "./prompt-form";
import { agentSessionContext } from "./router-contexts";
import { ToolCallContext } from "./tool-call-context";

export { action } from "./action";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Chat" }];
}

export const middleware: Route.MiddlewareFunction[] = [
  async ({ params, context }) => {
    const container = context.get(agentSessionContainerContext);
    const session = await container.get(params.id);
    if (!session) throw data(`Session ${JSON.stringify(params.id)} not found`, { status: 404 });
    context.set(agentSessionContext, session);
  },
];

export async function loader({ context }: Route.LoaderArgs) {
  const session = context.get(agentSessionContext);
  // Pass only the fields the Chat component uses, read directly from the
  // session, instead of a full SessionState snapshot.
  const messages = session.messages;
  const models = await session.modelRuntime.getAvailable();
  return {
    cwd: session.sessionManager.getCwd(),
    state: {
      model: session.model
        ? {
            name: session.model.name,
            provider: session.model.provider,
            id: session.model.id,
          }
        : null,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
    },
    messages,
    models,
  };
}

export default function Chat({
  params: { id: sessionId },
  loaderData: { cwd, state: loadedState, messages: loadedMessages, models },
}: Route.ServerComponentProps) {
  const { theme, toggleTheme } = useTheme();

  const [state, setState] = useState(loadedState);
  const [chat, dispatch] = useReducer(chatReducer, loadedMessages, createChatState);
  {
    // If the loader re-validates, event messages are now included in loader data.
    const prevLoadedMessages = useRef(loadedMessages);
    if (loadedMessages !== prevLoadedMessages.current) {
      prevLoadedMessages.current = loadedMessages;
      // Render-time dispatch is safe here because:
      // - it's conditional (only when loadedMessages reference changes), preventing infinite loop
      // - React applies it synchronously within the render phase, before commit
      // - this avoids race conditions with SSE events that useEffect would have
      dispatch({ type: "reset", loadedMessages });
    }
  }
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Whether the user is scrolled near the bottom (within 50px threshold)
  const shouldAutoScroll = useRef(true);

  const fetcher = useFetcher<typeof action>();

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
  }, [chat.eventMessages, chat.loadedMessages, scrollToBottom]);

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
    dispatch({ type: "reset", loadedMessages });
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
          if (data.sessionId !== sessionId) return;
          if (data.type === "internal:state") {
            setState({
              model: data.model,
              thinkingLevel: data.thinkingLevel,
              isStreaming: data.isStreaming,
            });
          } else {
            dispatch(data);
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
    model: { provider: string; modelId: string },
    thinkingLevel: ModelThinkingLevel,
  ) {
    // Show the user's own message immediately via `pendingUserMessage`; the
    // SSE `message_start` (user) event later promotes it into `messages`.
    dispatch({ type: "user_message", content: text });
    void fetcher.submit(
      {
        type: "prompt",
        text,
        model: { provider: model.provider, id: model.modelId },
        thinkingLevel,
      } satisfies ActionInput,
      {
        method: "post",
        encType: "application/json",
      },
    );
  }

  function abortMessage() {
    void fetcher.submit({ type: "abort" } satisfies ActionInput, {
      method: "post",
      encType: "application/json",
    });
    dispatch({ type: "abort" });
  }

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
            {state.isStreaming && (
              <button
                onClick={abortMessage}
                className="text-xs px-2.5 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
              >
                Abort
              </button>
            )}
            <Link
              to={`/session/new?dir=${encodeURIComponent(cwd)}`}
              className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              New
            </Link>
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollContainerRef} onScroll={handleScroll} viewportClassName="pb-36">
        <div className="max-w-5xl max-lg:max-w-[100vw] w-full mx-auto px-4 py-4 space-y-4 min-h-full min-w-0">
          {chat.loadedMessages.length === 0 &&
          chat.eventMessages.length === 0 &&
          !chat.pendingUserMessage ? (
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
            <ToolCallContext value={chat.toolCallMap}>
              {chat.loadedMessages.map((msg, index) => (
                <AgentMessage key={index} {...msg} />
              ))}
              {chat.eventMessages.map((msg) => (
                <AgentMessage key={msg._key} {...msg} />
              ))}
              {chat.pendingUserMessage && (
                <AgentMessage key={chat.pendingUserMessage._key} {...chat.pendingUserMessage} />
              )}
            </ToolCallContext>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <PromptForm
        key={sessionId}
        isStreaming={state.isStreaming}
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
