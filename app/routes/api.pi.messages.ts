import { jsonResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.messages";

export async function loader(_: Route.LoaderArgs) {
  const pi = getPiServer();
  const messages = pi.getMessages();
  return jsonResponse({ messages });
}
