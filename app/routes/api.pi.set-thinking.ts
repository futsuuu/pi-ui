import { getJsonBody, jsonResponse, errorResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";
import type { ThinkingLevel } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.set-thinking";

const validLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }
  const body = await getJsonBody(request);
  const level = body.level as string | undefined;
  if (!level || !validLevels.includes(level)) {
    return errorResponse(`Invalid thinking level. Valid: ${validLevels.join(", ")}`);
  }
  const pi = getPiServer();
  void pi.setThinkingLevel(level as ThinkingLevel);
  return jsonResponse({ success: true });
}
