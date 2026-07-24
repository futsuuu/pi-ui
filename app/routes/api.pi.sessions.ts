import { jsonResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.sessions";

export async function loader(_: Route.LoaderArgs) {
  const pi = getPiServer();
  const sessions = await pi.getSessionsList();
  return jsonResponse({ sessions });
}
