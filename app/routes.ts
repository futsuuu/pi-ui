import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sessions", "routes/sessions.tsx"),
  route("chat/:sessionId", "routes/chat.tsx"),

  // SSE streaming endpoint — kept as separate route because it uses ReadableStream
  route("api/pi/events", "routes/api.pi.events.ts"),
] satisfies RouteConfig;
