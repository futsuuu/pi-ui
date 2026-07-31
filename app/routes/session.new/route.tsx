import { redirect } from "react-router";

import { agentSessionContainerContext } from "~/router-contexts";

import type { Route } from "./+types/route";

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const dir = url.searchParams.get("dir");
  if (!dir) {
    throw redirect("/");
  }
  const container = context.get(agentSessionContainerContext);
  const session = await container.create(dir);
  throw redirect(`/session/${encodeURIComponent(session.sessionId)}`);
}
