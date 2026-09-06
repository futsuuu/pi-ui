import { data } from "react-router";
import * as v from "valibot";

import { providerAuthManagerContext } from "~/router-contexts";

import { isJsonContentRequest, isSameOriginRequest } from "../settings/auth-guards";
import type { Route } from "./+types/route";

const AuthResourceActionSchema = v.variant("type", [
  v.object({
    type: v.literal("answer"),
    promptId: v.pipe(v.number(), v.integer(), v.minValue(1)),
    answer: v.pipe(v.string(), v.minLength(1)),
  }),
  v.object({
    type: v.literal("cancel"),
  }),
]);

export async function loader({ params, context }: Route.LoaderArgs) {
  const manager = context.get(providerAuthManagerContext);
  const operation = manager.getSnapshot(params.id);
  if (!operation) {
    return data({ error: "not_found" }, { status: 404 });
  }
  return { operation };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isSameOriginRequest(request)) {
    return data({ error: "Forbidden" }, { status: 403 });
  }
  if (!isJsonContentRequest(request)) {
    return data({ error: "Unsupported media type" }, { status: 415 });
  }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return data({ error: "Invalid request" }, { status: 400 });
  }
  const result = v.safeParse(AuthResourceActionSchema, parsed);
  if (!result.success) {
    return data({ error: "Invalid request" }, { status: 400 });
  }
  const manager = context.get(providerAuthManagerContext);
  if (result.output.type === "answer") {
    const answered = manager.answerPrompt(params.id, result.output.promptId, result.output.answer);
    if (!answered.ok) {
      if (answered.error === "not_found") {
        return data({ error: "not_found" }, { status: 404 });
      }
      if (answered.error === "stale_prompt") {
        return data({ error: "stale_prompt" }, { status: 409 });
      }
      if (answered.error === "incompatible_kind") {
        return data({ error: "incompatible_kind" }, { status: 400 });
      }
      return data({ error: "invalid_state" }, { status: 409 });
    }
    return { ok: true as const };
  }
  const cancelled = manager.cancelLogin(params.id);
  if (!cancelled.ok) {
    if (cancelled.error === "not_found") {
      return data({ error: "not_found" }, { status: 404 });
    }
    if (cancelled.error === "incompatible_kind") {
      return data({ error: "incompatible_kind" }, { status: 400 });
    }
    return data({ error: "invalid_state" }, { status: 409 });
  }
  return { ok: true as const };
}
