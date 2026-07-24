import { jsonResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.fs.home-dir";

export async function loader(_: Route.LoaderArgs) {
  const pi = getPiServer();
  return jsonResponse({ homeDir: pi.getHomeDir(), recentDirs: pi.getRecentDirs() });
}
