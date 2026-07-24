import { jsonResponse, errorResponse } from "~/lib/api-helpers";
import { getPiServer } from "~/lib/pi-server";

import type { Route } from "./+types/api.fs.dirs";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const dirPath = url.searchParams.get("path");
  if (!dirPath) {
    return errorResponse("path query parameter is required");
  }
  const pi = getPiServer();
  const entries = await pi.listDirectory(dirPath);
  return jsonResponse({ entries, path: dirPath });
}
