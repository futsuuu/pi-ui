import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { agentSessionContainerContext } from "~/router-contexts";
import type { SessionInfo } from "~/session-info";
import type { SessionReadState } from "~/session-view-state";

import type { Route } from "./+types/route";

/** Messages sent on the global `/events` SSE stream. */
export type SseEvent =
  | { type: "internal:init"; sessions: SessionInfo[] }
  | { type: "internal:event"; sessionId: string; event: AgentSessionEvent; info: SessionInfo }
  | {
      type: "internal:view_state";
      sessionId: string;
      viewState: SessionReadState;
    }
  | { type: "internal:deleted"; sessionId: string };

export async function loader({ context }: Route.LoaderArgs) {
  const container = context.get(agentSessionContainerContext);

  let teardown: (() => void) | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // Serialize sends through a per-connection queue: the async info
      // lookup must not reorder events (the chat reducer depends on order).
      let queue: Promise<void> = Promise.resolve();
      const enqueue = (produce: () => SseEvent | Promise<SseEvent | undefined>) => {
        queue = queue
          .then(async () => {
            const event = await produce();
            if (!event) return; // dropped (see below)
            const data = `data: ${JSON.stringify(event)}\n\n`;
            try {
              controller.enqueue(encoder.encode(data));
            } catch {
              // Stream closed (client gone): release the subscription,
              // keep-alive timer, and controller.
              teardown?.();
            }
          })
          .catch((error) => {
            console.error("SSE enqueue failed:", error);
          });
      };

      let unsubscribe: (() => void) | undefined;
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      let cleanedUp = false;
      teardown = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (keepAlive) clearInterval(keepAlive);
        unsubscribe?.();
        try {
          controller.close();
        } catch {}
      };

      const infos = new Map<string, SessionInfo>();
      // Subscribe before seeding from the info list: events broadcast while
      // the scan runs are buffered and flushed after `internal:init` instead
      // of being lost to this connection.
      let buffering = true;
      const buffer: Array<() => SseEvent | Promise<SseEvent | undefined>> = [];
      unsubscribe = container.subscribe((sessionId, event) => {
        const produce = (): SseEvent | Promise<SseEvent | undefined> => {
          if (event.type === "session_deleted") {
            infos.delete(sessionId);
            return { type: "internal:deleted", sessionId };
          }
          if (event.type === "view_state") {
            // A dedicated event: read-state changes must never reach the chat
            // reducer as if they were agent events.
            return { type: "internal:view_state", sessionId, viewState: event.viewState };
          }
          return (async () => {
            let info: SessionInfo | null = null;
            try {
              info = await container.currentInfo(sessionId);
            } catch {
              // fall back to the last known info below
            }
            info ??= infos.get(sessionId) ?? null;
            // Events only originate from loaded runtimes, so `info` is known
            // in practice; the drop only happens when a runtime was disposed
            // concurrently, and `internal:deleted` follows in that case.
            if (!info) return;
            infos.set(sessionId, info);
            return { type: "internal:event", sessionId, event, info };
          })();
        };
        if (buffering) buffer.push(produce);
        else enqueue(produce);
      });

      for (const info of await container.currentInfoList()) {
        infos.set(info.id, info);
      }
      if (cleanedUp) return; // canceled while the info list loads

      enqueue(() => ({ type: "internal:init", sessions: [...infos.values()] }));
      buffering = false;
      for (const produce of buffer) enqueue(produce);

      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          teardown?.();
        }
      }, 15000);
    },
    cancel() {
      teardown?.();
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
