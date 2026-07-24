import { jsonResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.state";

export async function loader(_: Route.LoaderArgs) {
  const pi = getPiServer();
  await pi.ensureInitialized();
  return jsonResponse(pi.getState());
}
