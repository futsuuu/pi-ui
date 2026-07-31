import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { agentSessionContainerContext } from "~/router-contexts";

import { agentSessionContext } from "../session.$id/router-contexts";
import type { Route } from "./+types/route";

export type SseEvent =
  | (AgentSessionEvent & { sessionId: string })
  | (SessionState & { type: "internal:state" });

export interface SessionState {
  model: { name: string; provider: string; id: string } | null;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile: string | null;
  sessionId: string | null;
  sessionName: string | null;
  messageCount: number;
}

export async function loader({ params: { id: sessionId }, context }: Route.LoaderArgs) {
  const container = context.get(agentSessionContainerContext);
  const session = context.get(agentSessionContext);

  let cleanup: (() => void) | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let cleanedUp = false;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (event: SseEvent) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Stream might be closed
        }
      };

      // Send initial state first
      enqueue({ type: "internal:state", ...getSessionState(session) });

      const unsubscribe = container.subscribe((eventSessionId, event) => {
        // If this connection is scoped to a session, skip other sessions' events
        if (eventSessionId !== sessionId) return;
        enqueue({ ...event, sessionId });
        // Broadcast a state snapshot on key state changes so clients can
        // update isStreaming, model, thinkingLevel, etc.
        if (
          event.type === "message_start" ||
          event.type === "message_end" ||
          event.type === "turn_end" ||
          event.type === "agent_settled" ||
          event.type === "agent_end" ||
          event.type === "thinking_level_changed" ||
          event.type === "session_info_changed"
        ) {
          enqueue({ type: "internal:state", ...getSessionState(session) });
        }
      });

      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepAlive);
        }
      }, 15000);

      cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
    },
    cancel() {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(keepAlive);
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function getSessionState(session: AgentSession): SessionState {
  return {
    model: session.model
      ? {
          name: session.model.name,
          provider: session.model.provider,
          id: session.model.id,
        }
      : null,
    thinkingLevel: session.thinkingLevel,
    isStreaming: session.isStreaming,
    isCompacting: session.isCompacting,
    sessionFile: session.sessionFile ?? null,
    sessionId: session.sessionId,
    sessionName: session.sessionName ?? null,
    messageCount: session.messages.length,
  };
}
