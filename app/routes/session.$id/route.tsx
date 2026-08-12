import type { AgentMessage as SessionMessage } from "@earendil-works/pi-agent-core";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { Layers, Moon, Plus, Sun } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { data, Link, useFetcher } from "react-router";

import { ScrollArea } from "~/components/scroll-area";
import { useSessionStream } from "~/contexts/session-events";
import { useTheme } from "~/contexts/theme";
import { agentSessionContainerContext } from "~/router-contexts";

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

/** Length of the streamed text in the newest partial message. */
function textLengthOf(message: SessionMessage): number {
  if (message.role !== "assistant") return 0;
  let length = 0;
  for (const block of message.content) {
    if (block.type === "text") length += block.text.length;
  }
  return length;
}

export async function loader({ context }: Route.LoaderArgs) {
  const session = context.get(agentSessionContext);
  // Pass only the fields the Chat component uses, read directly from the
  // session, instead of the full SessionInfo.
  const messages = session.messages;
  // The model list is streamed to the client as a promise.
  const models = session.modelRuntime.getAvailable();
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
  const fetcher = useFetcher<typeof action>();

  // The global /events stream: current info for this session (model,
  // thinking level, streaming flag) plus its events. The provider only
  // delivers events for the subscribed session, so no filtering is needed.
  const { info, connected, subscribe } = useSessionStream(sessionId);

  // Reset local state when navigating to a different session.
  // Only depend on sessionId so that loader re-validation after actions
  // doesn't overwrite SSE-streamed messages.
  useEffect(() => {
    setState(loadedState);
    dispatch({ type: "reset", loadedMessages });
  }, [sessionId]);

  // Forward the session's stream events to the chat reducer. Per-token
  // `message_update` partials are coalesced into a single dispatch: the
  // streaming message re-renders and re-parses its markdown on every token,
  // a cost that grows with the text length. The delay for each batch is
  // derived from the newest partial at the time the batch starts (16ms for
  // short text, capped at 200ms), so the interval widens as the stream grows.
  const pendingUpdateRef = useRef<AgentSessionEvent | null>(null);
  const updateTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const flushPendingUpdate = () => {
      if (updateTimerRef.current != null) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }
      const pending = pendingUpdateRef.current;
      pendingUpdateRef.current = null;
      if (pending) dispatch(pending);
    };
    const unsubscribe = subscribe((event) => {
      if (event.type !== "message_update") {
        // Non-delta events (message_start/end, tool steps, turn/agent end)
        // must not be reordered behind a pending partial: flush it first.
        flushPendingUpdate();
        dispatch(event);
        return;
      }
      // Keep only the newest partial; render it after a delay that grows
      // with the streamed text length so long streams don't drop frames.
      pendingUpdateRef.current = event;
      if (updateTimerRef.current == null) {
        const interval = Math.min(16 + Math.floor(textLengthOf(event.message) / 250), 200);
        updateTimerRef.current = window.setTimeout(() => {
          updateTimerRef.current = null;
          const pending = pendingUpdateRef.current;
          pendingUpdateRef.current = null;
          if (pending) dispatch(pending);
        }, interval);
      }
    });
    return () => {
      unsubscribe();
      if (updateTimerRef.current != null) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, [subscribe]);

  // Reflect the streamed session state into the local state.
  useEffect(() => {
    if (info) {
      setState({
        model: info.model,
        thinkingLevel: info.thinkingLevel,
        isStreaming: info.isStreaming,
      });
    }
  }, [info]);

  const sendMessage = useCallback(
    (
      text: string,
      model: { provider: string; modelId: string },
      thinkingLevel: ModelThinkingLevel,
    ) => {
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
    },
    [fetcher],
  );

  function abortMessage() {
    void fetcher.submit({ type: "abort" } satisfies ActionInput, {
      method: "post",
      encType: "application/json",
    });
    dispatch({ type: "abort" });
  }

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
      <ScrollArea key={`messages-${sessionId}`} autoScroll viewportClassName="pb-36">
        <div className="max-w-5xl max-lg:max-w-[100vw] w-full mx-auto px-4 py-4 space-y-4 min-h-full min-w-0">
          {state.model == null && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              No model configured. Set an API key environment variable (e.g. ANTHROPIC_API_KEY), or
              select a model from the dropdown below.
            </p>
          )}
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
        </div>
      </ScrollArea>

      <PromptForm
        key={`prompt-${sessionId}`}
        isStreaming={state.isStreaming}
        models={models}
        defaultModel={state.model}
        defaultThinkingLevel={state.thinkingLevel ?? "medium"}
        onSend={sendMessage}
      />
    </div>
  );
}
