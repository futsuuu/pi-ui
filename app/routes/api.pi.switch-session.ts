import { getJsonBody, jsonResponse, errorResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.switch-session";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }
  const body = await getJsonBody(request);
  const sessionPath = body.sessionPath as string | undefined;
  if (!sessionPath) {
    return errorResponse("sessionPath is required");
  }
  const pi = getPiServer();
  await pi.switchSession(sessionPath);
  return jsonResponse({ success: true, sessionId: pi.getState().sessionId });
}
