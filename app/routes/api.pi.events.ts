import { getPiServer, type SseEvent } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.events";

export async function loader({ request }: Route.LoaderArgs) {
  const pi = getPiServer();
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  let cleanup: (() => void) | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let cleanedUp = false;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let buffer: string[] = [];
      let ready = !sessionId; // no filter → forward events immediately

      // Subscribe immediately so no events are missed; buffer until ready
      const unsubscribe = pi.subscribe((event) => {
        // If this connection is scoped to a session, skip other sessions' events
        if (sessionId && event.sessionId && event.sessionId !== sessionId) return;

        const data = `data: ${JSON.stringify(event)}\n\n`;
        if (ready) {
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            // Stream might be closed
          }
        } else {
          buffer.push(data);
        }
      });

      if (sessionId) {
        // Send initial state first, then flush buffered events
        void pi
          .getState(sessionId)
          .then((state) => {
            const event: SseEvent = { type: "internal:state", ...state };
            const initial = `data: ${JSON.stringify(event)}\n\n`;
            try {
              controller.enqueue(encoder.encode(initial));
            } catch {}
          })
          .finally(() => {
            ready = true;
            // Flush buffered events (preserving order: initial state → buffered → live)
            for (const item of buffer) {
              try {
                controller.enqueue(encoder.encode(item));
              } catch {}
            }
            buffer = [];
          });
      }

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
