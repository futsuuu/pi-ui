import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sessions", "routes/sessions.tsx"),
  route("chat/:sessionId", "routes/chat.tsx"),

  // API routes
  route("api/pi/state", "routes/api.pi.state.ts"),
  route("api/pi/events", "routes/api.pi.events.ts"),
  route("api/pi/messages", "routes/api.pi.messages.ts"),
  route("api/pi/prompt", "routes/api.pi.prompt.ts"),
  route("api/pi/steer", "routes/api.pi.steer.ts"),
  route("api/pi/follow-up", "routes/api.pi.follow-up.ts"),
  route("api/pi/abort", "routes/api.pi.abort.ts"),
  route("api/pi/models", "routes/api.pi.models.ts"),
  route("api/pi/set-model", "routes/api.pi.set-model.ts"),
  route("api/pi/set-thinking", "routes/api.pi.set-thinking.ts"),
  route("api/pi/change-cwd", "routes/api.pi.change-cwd.ts"),
  route("api/pi/sessions", "routes/api.pi.sessions.ts"),
  route("api/pi/switch-session", "routes/api.pi.switch-session.ts"),
  route("api/pi/new-session", "routes/api.pi.new-session.ts"),
  route("api/fs/dirs", "routes/api.fs.dirs.ts"),
  route("api/fs/home-dir", "routes/api.fs.home-dir.ts"),
] satisfies RouteConfig;
