import { getJsonBody, jsonResponse, errorResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.change-cwd";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }
  const body = await getJsonBody(request);
  const cwd = body.cwd as string | undefined;
  if (!cwd) {
    return errorResponse("cwd is required");
  }
  const pi = getPiServer();
  // This will reinitialize Pi session
  // Fire and forget - the SSE stream will send the updated state
  pi.changeCwd(cwd).catch(console.error);
  return jsonResponse({ success: true });
}
