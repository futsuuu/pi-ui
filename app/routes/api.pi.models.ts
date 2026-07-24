import { jsonResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.models";

export async function loader(_: Route.LoaderArgs) {
  const pi = getPiServer();
  const models = await pi.getModels();
  return jsonResponse({ models });
}
