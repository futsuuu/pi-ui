import { getJsonBody, jsonResponse, errorResponse } from "~/lib/api-helpers";
import { getPiServer, type ThinkingLevel } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.follow-up";

const validLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }
  const body = await getJsonBody(request);
  const message = body.message as string | undefined;
  if (!message) {
    return errorResponse("Message is required");
  }

  // Optional: apply model and/or thinking level before follow-up
  const modelRaw = body.model as { provider?: string; modelId?: string } | undefined;
  const model =
    modelRaw?.provider && modelRaw?.modelId
      ? { provider: modelRaw.provider, modelId: modelRaw.modelId }
      : undefined;

  const thinkingLevelRaw = body.thinkingLevel as string | undefined;
  const thinkingLevel =
    thinkingLevelRaw && validLevels.includes(thinkingLevelRaw)
      ? (thinkingLevelRaw as ThinkingLevel)
      : undefined;

  const pi = getPiServer();
  pi.followUp(message, { model, thinkingLevel }).catch(console.error);
  return jsonResponse({ success: true });
}
