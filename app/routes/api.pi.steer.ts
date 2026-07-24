import { getJsonBody, jsonResponse, errorResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.steer";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }
  const body = await getJsonBody(request);
  const message = body.message as string | undefined;
  if (!message) {
    return errorResponse("Message is required");
  }
  const pi = getPiServer();
  pi.steer(message).catch(console.error);
  return jsonResponse({ success: true });
}
