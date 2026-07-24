import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.events";

export async function loader(_: Route.LoaderArgs) {
  const pi = getPiServer();
  await pi.ensureInitialized();

  let cleanup: (() => void) | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let cleanedUp = false;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial state
      const state = pi.getState();
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "pi:state", ...state })}\n\n`),
      );

      // Subscribe to Pi events
      const unsubscribe = pi.subscribe((event) => {
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // Stream might be closed
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
