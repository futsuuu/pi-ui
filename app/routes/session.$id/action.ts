import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import * as v from "valibot";

import { agentSessionContainerContext } from "~/router-contexts";

import type { Route } from "./+types/route";
import { agentSessionContext } from "./router-contexts";

const ActionSchema = v.variant("type", [
  v.object({
    type: v.literal("abort"),
  }),
  v.object({
    type: v.literal("mark_displayed"),
    messageKey: v.pipe(
      v.string(),
      v.minLength(1),
      v.regex(/^(?:user|assistant):\d+|^toolResult:.+$/),
    ),
  }),
  v.object({
    type: v.union([v.literal("prompt"), v.literal("steer"), v.literal("follow-up")]),
    text: v.pipe(v.string(), v.minLength(1)),
    model: v.object({
      provider: v.string(),
      id: v.string(),
    }),
    thinkingLevel: v.picklist([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ] satisfies ModelThinkingLevel[]),
  }),
]);

export type ActionInput = v.InferInput<typeof ActionSchema>;

export async function action({ request, context }: Route.ActionArgs) {
  const body = await request.json();
  const action = v.parse(ActionSchema, body);
  const session = context.get(agentSessionContext);
  if (action.type === "abort") {
    await session.abort();
    return;
  }
  if (action.type === "mark_displayed") {
    // Ordering and key validation live in the session container, which owns
    // the current projection for the session. Returns the resulting read
    // state so the client can update its local cursor.
    const container = context.get(agentSessionContainerContext);
    return await container.markMessageDisplayed(session.sessionId, action.messageKey);
  }
  if (action.type === "prompt" || action.type === "steer" || action.type === "follow-up") {
    if (
      session.model?.provider !== action.model.provider ||
      session.model?.id !== action.model.id
    ) {
      const model = session.modelRuntime.getModel(action.model.provider, action.model.id);
      if (model) {
        await session.setModel(model);
      }
    }
    if (session.thinkingLevel !== action.thinkingLevel) {
      session.setThinkingLevel(action.thinkingLevel);
    }
    if (action.type === "prompt") {
      await session.prompt(action.text);
    } else if (action.type === "steer") {
      await session.steer(action.text);
    } else if (action.type === "follow-up") {
      await session.followUp(action.text);
    }
  }
}
