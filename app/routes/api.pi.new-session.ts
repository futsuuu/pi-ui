import { jsonResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.new-session";

export async function action(_: Route.ActionArgs) {
  const pi = getPiServer();
  await pi.newSession();
  return jsonResponse({ success: true, sessionId: pi.getState().sessionId });
}
