import { homedir } from "node:os";

import type { AgentMessage as SessionMessage } from "@earendil-works/pi-agent-core";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { data, useFetcher, useRevalidator } from "react-router";
import { css } from "styled-system/css";

import { mergedSessionMessages } from "~/agent-session-container";
import { ScrollArea } from "~/components/scroll-area";
import { useSessionStream } from "~/contexts/session-events";
import { agentSessionContainerContext } from "~/router-contexts";

import type { Route } from "./+types/route";
import type { ActionInput, action } from "./action";
import { AgentMessage } from "./agent-message";
import { createChatState, chatReducer, chatDisplayKeys } from "./chat-reducer";
import { useChatSync } from "./chat-sync";
import { isForwardKey, selectReportedKey } from "./display-tracker";
import { entryKeyOf, messageKeyOf } from "./message-key";
import { PathDisplayProvider } from "./path-display-context";
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

/**
 * Measures the text content of an assistant message.
 *
 * @param message - The session message whose text content is measured
 * @returns The combined length of all text blocks, or `0` for non-assistant messages
 */
function textLengthOf(message: SessionMessage): number {
  if (message.role !== "assistant") return 0;
  let length = 0;
  for (const block of message.content) {
    if (block.type === "text") length += block.text.length;
  }
  return length;
}

/**
 * Renders a message with a stable `data-message-key` so the viewport
 * observer can track it. Messages without a display key (empty user messages,
 * finalized empty assistant messages) render without a wrapper — they must
 * never advance the shared cursor because they render nothing.
 */
function TrackedMessage({
  messageKey,
  children,
}: {
  messageKey: string | null;
  children: ReactNode;
}) {
  if (messageKey == null) return children;
  return <div data-message-key={messageKey}>{children}</div>;
}

/**
 * Loads the session data required to render the chat interface.
 *
 * @returns The session messages, in-flight turn events, model options, session state, directories, and shared display state.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const container = context.get(agentSessionContainerContext);
  const session = context.get(agentSessionContext);
  // Pass only the fields the Chat component uses, read directly from the
  // session, instead of the full SessionInfo.
  const messages = mergedSessionMessages(session);
  // The model list is streamed to the client as a promise.
  const models = session.modelRuntime.getAvailable();
  // The in-flight turn's events, so a client that mounts mid-turn can render
  // the streaming partial and tool executions without having seen their first
  // event (closes the [loader read -> subscription] loss window).
  const turnEvents = container.getTurnEvents(session.sessionId);
  // The initial read state: the shared display cursor plus the latest
  // renderable message key. The first render restores this anchor before any
  // display observer reports a position.
  const viewState = await container.getSessionReadState(session.sessionId);
  return {
    cwd: session.sessionManager.getCwd(),
    home: homedir(),
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
    turnEvents,
    models,
    viewState,
  };
}

export default function SessionRoute(props: Route.ServerComponentProps) {
  // Re-mount Chat per session: the reducer seed, loader-derived state, and
  // the sync guards start fresh, so no session-change effect is needed.
  return <Chat key={props.params.id} {...props} />;
}

/**
 * Renders the chat session interface, including messages, connection status, session controls, and prompt submission.
 *
 * @param params - Route parameters containing the session identifier.
 * @param loaderData - Initial session data, including messages, model state, available models, turn events, and display state.
 */
function Chat({
  params: { id: sessionId },
  loaderData: {
    cwd,
    home,
    state: loadedState,
    messages: loadedMessages,
    turnEvents,
    models,
    viewState: loadedViewState,
  },
}: Route.ServerComponentProps) {
  const [state, setState] = useState(loadedState);
  const [chat, dispatch] = useReducer(chatReducer, null, () =>
    // Seed the loader's turn events on the first render: the in-flight
    // partial and tool executions render before any stream event arrives.
    chatReducer(createChatState(loadedMessages, sessionId), {
      type: "reset",
      loadedMessages,
      turnEvents,
      sessionId,
    }),
  );
  {
    // If the loader re-validates, the fresh snapshot and turn events replace
    // the previous ones. Render-time state adjustment is the supported
    // pattern for comparing against a previous render's values: the reset is
    // dispatched only when a reference changes, and React applies it
    // synchronously within the render phase (it cannot be dropped by an
    // abandoned render, unlike a ref write).
    const [prevLoaded, setPrevLoaded] = useState({ messages: loadedMessages, turnEvents });
    if (loadedMessages !== prevLoaded.messages || turnEvents !== prevLoaded.turnEvents) {
      setPrevLoaded({ messages: loadedMessages, turnEvents });
      dispatch({ type: "reset", loadedMessages, turnEvents, sessionId });
    }
  }
  const fetcher = useFetcher<typeof action>();
  // Dedicated fetcher for display reports: a `mark_displayed` response (the
  // read state) must never overwrite prompt/abort data on the shared fetcher.
  const displayFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  // The global /events stream: current info for this session (model,
  // thinking level, streaming flag), its read state, and its events. The
  // provider only delivers events for the subscribed session, so no
  // filtering is needed.
  const { info, viewState, connected, subscribe } = useSessionStream(sessionId);

  // Close the [loader read -> subscription] window and [disconnect ->
  // reconnect] outages with one revalidation per session, guarded against a
  // flapping connection.
  useChatSync({
    sessionId,
    connected,
    isStreaming: state.isStreaming,
    initialStreaming: loadedState.isStreaming,
    hasTurnEvents: turnEvents.length > 0,
    revalidatorState: revalidator.state,
    revalidate: revalidator.revalidate,
  });

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
        updateTimerRef.current = null;
      }
      pendingUpdateRef.current = null;
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

  // --- Shared display cursor (the server-side read state) ---
  //
  // While messages are visible in the viewport, the newest visible message is
  // reported to the server, which keeps one forward-only cursor per session.
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef(chat);
  // Keep the observer callbacks reading the committed chat state, not a value
  // from a discarded render.
  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);
  // The server cursor this client knows about. It is the floor for reports:
  // older messages are never submitted again, and a stale report can never
  // regress it.
  const cursorRef = useRef<string | null>(loadedViewState?.lastDisplayedMessageKey ?? null);
  // Restore to the shared cursor's message; when it is the latest message
  // the scroll clamps to the bottom naturally (no read-state branch needed).
  const restoreTarget = loadedViewState?.lastDisplayedMessageKey ?? null;
  // The observer must not report anything until the shared anchor has been
  // restored: before that, the initial render position (top or bottom) is not
  // a faithful view of the conversation.
  const restorePendingRef = useRef(restoreTarget != null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const handleRestoreComplete = useCallback(() => {
    restorePendingRef.current = false;
    // Initial intersection notifications delivered while the restore was
    // pending were dropped. IntersectionObserver only fires again on state
    // changes, so a short conversation that fits the viewport would never be
    // reported; re-observing forces fresh initial notifications for every
    // tracked element.
    const observer = observerRef.current;
    if (!observer) return;
    for (const el of observedElementsRef.current) {
      observer.unobserve(el);
      observer.observe(el);
    }
  }, []);
  const pendingReportRef = useRef<string | null>(null);
  const reportTimerRef = useRef<number | null>(null);
  const observedElementsRef = useRef<Set<Element>>(new Set());
  const displayFetcherRef = useRef(displayFetcher);
  useEffect(() => {
    displayFetcherRef.current = displayFetcher;
  }, [displayFetcher]);

  const bumpCursor = useCallback((candidate: string) => {
    // Only forward progress, in the client's own display order; the server
    // enforces the same rule, so this only avoids redundant submissions.
    if (isForwardKey(candidate, chatDisplayKeys(chatRef.current), cursorRef.current)) {
      cursorRef.current = candidate;
    }
  }, []);

  const flushReport = useCallback(() => {
    if (reportTimerRef.current != null) {
      clearTimeout(reportTimerRef.current);
      reportTimerRef.current = null;
    }
    const key = pendingReportRef.current;
    pendingReportRef.current = null;
    if (key == null) return;
    // Re-check forward progress at flush time: a stale report that arrived
    // after the cursor advanced (e.g. an SSE update from another client) is
    // dropped instead of being submitted redundantly.
    const keys = chatDisplayKeys(chatRef.current);
    if (!isForwardKey(key, keys, cursorRef.current)) return;
    void displayFetcherRef.current.submit(
      { type: "mark_displayed", messageKey: key } satisfies ActionInput,
      { method: "post", encType: "application/json" },
    );
  }, []);

  const scheduleReport = useCallback(
    (key: string) => {
      // Debounce: normal scrolling must not create one request per
      // intersection event; the newest candidate wins within a window.
      pendingReportRef.current = key;
      if (reportTimerRef.current == null) {
        reportTimerRef.current = window.setTimeout(flushReport, 150);
      }
    },
    [flushReport],
  );

  // Observe the message elements intersecting the viewport and report the
  // newest one. The observer is re-attached per session (Chat remounts), and
  // newly mounted messages are picked up via a MutationObserver.
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    const container = messagesContainerRef.current;
    if (!viewport || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (restorePendingRef.current) return;
        // When multiple messages are visible, report the one with the
        // greatest position in the current rendered message order.
        const keys = chatDisplayKeys(chatRef.current);
        const observations = entries.map((entry) => ({
          key: (entry.target as HTMLElement).dataset.messageKey ?? null,
          intersecting: entry.isIntersecting,
        }));
        const best = selectReportedKey(observations, keys, cursorRef.current);
        if (best != null) scheduleReport(best);
      },
      { root: viewport },
    );
    observerRef.current = observer;
    const observeIn = (root: ParentNode) => {
      for (const el of root.querySelectorAll<HTMLElement>("[data-message-key]")) {
        if (!observedElementsRef.current.has(el)) {
          observedElementsRef.current.add(el);
          observer.observe(el);
        }
      }
    };
    observeIn(container);
    // Only added nodes carry new message elements; scanning their subtrees
    // avoids re-querying every rendered message on each streamed-token
    // mutation (markdown re-renders mutate text deep inside the tree).
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          // A removed element may be a message wrapper itself or contain
          // tracked descendants (a loader reset replaces the whole list):
          // unobserve each and drop it from the tracked set so stale elements
          // are neither retained by the observer nor re-observed later.
          for (const el of [node, ...node.querySelectorAll<HTMLElement>("[data-message-key]")]) {
            if (observedElementsRef.current.delete(el)) observer.unobserve(el);
          }
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.dataset.messageKey != null && !observedElementsRef.current.has(node)) {
            observedElementsRef.current.add(node);
            observer.observe(node);
          }
          observeIn(node);
        }
      }
    });
    mutationObserver.observe(container, { childList: true, subtree: true });
    return () => {
      observerRef.current = null;
      observer.disconnect();
      mutationObserver.disconnect();
      // Mutating the tracked set and clearing the latest timer/pending report on
      // unmount is intentional; the refs are mutable state, not rendered nodes.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      observedElementsRef.current.clear();
      if (reportTimerRef.current != null) {
        clearTimeout(reportTimerRef.current);
        reportTimerRef.current = null;
      }
      pendingReportRef.current = null;
    };
  }, [scheduleReport]);

  // Advance the local cursor from SSE read-state updates (another client
  // displayed a newer message) and from mark_displayed action responses.
  useEffect(() => {
    if (viewState?.lastDisplayedMessageKey) {
      bumpCursor(viewState.lastDisplayedMessageKey);
    }
  }, [viewState, bumpCursor]);

  useEffect(() => {
    const data = displayFetcher.data;
    if (
      data &&
      typeof data === "object" &&
      "lastDisplayedMessageKey" in data &&
      typeof data.lastDisplayedMessageKey === "string"
    ) {
      bumpCursor(data.lastDisplayedMessageKey);
    }
  }, [displayFetcher.data, bumpCursor]);

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
    // Depend on the whole fetcher: ignoring state transitions would capture a
    // stale submit when the form is used before a pending navigation settles.
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
    <div
      className={css({
        height: "full",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      })}
    >
      {/* Top bar — fixed at top */}
      <div
        className={css({
          flexShrink: 0,
          backgroundColor: "bg.panel",
          borderBottomWidth: "1px",
          borderColor: "border.panel",
        })}
      >
        <div
          className={css({
            maxWidth: "5xl",
            marginInline: "auto",
            paddingInlineStart: "14",
            paddingInlineEnd: "4",
            lg: { paddingInline: "4" },
            height: "14",
            display: "flex",
            alignItems: "center",
          })}
        >
          <div className={css({ display: "flex", alignItems: "center", gap: "2" })}>
            <span
              className={css({
                width: "2",
                height: "2",
                borderRadius: "full",
                backgroundColor: connected ? "green.500" : "red.500",
              })}
            />
            <span className={css({ textStyle: "xs", color: "fg.muted" })}>
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea
        key={`messages-${sessionId}`}
        ref={messagesViewportRef}
        autoScroll
        restoreTarget={restoreTarget}
        onRestoreComplete={handleRestoreComplete}
        disableHorizontalScroll
        viewportClassName={css({ paddingBottom: "9rem" })}
      >
        <div
          ref={messagesContainerRef}
          className={css({
            maxWidth: "5xl",
            width: "full",
            marginInline: "auto",
            paddingInline: "4",
            paddingBlock: "4",
            minHeight: "full",
            minWidth: 0,
            "& > :not([hidden]) ~ :not([hidden])": { marginTop: "4" },
          })}
        >
          {state.model == null && (
            <p
              className={css({
                textStyle: "sm",
                color: "danger",
                backgroundColor: "danger.soft",
                borderWidth: "1px",
                borderColor: "danger.border",
                borderRadius: "lg",
                paddingInline: "3",
                paddingBlock: "2",
              })}
            >
              No model configured. Set an API key environment variable (e.g. ANTHROPIC_API_KEY), or
              select a model from the dropdown below.
            </p>
          )}
          <PathDisplayProvider value={{ cwd, home }}>
            <ToolCallContext value={chat.toolCallMap}>
              {chat.loadedMessages.map((msg, index) => (
                <TrackedMessage key={index} messageKey={messageKeyOf(msg)}>
                  <AgentMessage {...msg} />
                </TrackedMessage>
              ))}
              {chat.eventMessages.map((msg) => (
                <TrackedMessage key={msg._key} messageKey={entryKeyOf(msg)}>
                  <AgentMessage {...msg} />
                </TrackedMessage>
              ))}
              {chat.pendingUserMessage && (
                <TrackedMessage
                  key={chat.pendingUserMessage._key}
                  messageKey={entryKeyOf(chat.pendingUserMessage)}
                >
                  <AgentMessage {...chat.pendingUserMessage} />
                </TrackedMessage>
              )}
            </ToolCallContext>
          </PathDisplayProvider>
        </div>
      </ScrollArea>

      <PromptForm
        key={`prompt-${sessionId}`}
        isStreaming={state.isStreaming}
        models={models}
        defaultModel={state.model}
        defaultThinkingLevel={state.thinkingLevel ?? "medium"}
        onSend={sendMessage}
        onAbort={abortMessage}
      />
    </div>
  );
}
