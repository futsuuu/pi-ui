import { jsonResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.pi.abort";

export async function action(_: Route.ActionArgs) {
  const pi = getPiServer();
  pi.abort().catch(console.error);
  return jsonResponse({ success: true });
}
