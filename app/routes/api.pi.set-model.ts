import { getJsonBody, jsonResponse, errorResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.set-model";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }
  const body = await getJsonBody(request);
  const provider = body.provider as string | undefined;
  const modelId = body.modelId as string | undefined;
  if (!provider || !modelId) {
    return errorResponse("provider and modelId are required");
  }
  const pi = getPiServer();
  await pi.setModel(provider, modelId);
  return jsonResponse({ success: true });
}
