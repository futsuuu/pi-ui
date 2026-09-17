import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import * as v from "valibot";

import { sessionActivitySourceContext, sessionExecutorContext } from "~/router-contexts";

import type { Route } from "./+types/route";
import { sessionIdContext } from "./router-contexts";

const ActionSchema = v.variant("type", [
  v.object({
    type: v.literal("abort"),
  }),
  v.object({
    type: v.literal("mark_displayed"),
    messageKey: v.pipe(
      v.string(),
      v.minLength(1),
      v.regex(/^(?:(?:user|assistant):\d+|toolResult:.+)$/),
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

/**
 * Processes an abort, message-display, prompt, steering, or follow-up action for a session.
 *
 * @returns The updated message read state for a `mark_displayed` action; otherwise `undefined`.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const body = await request.json();
  const action = v.parse(ActionSchema, body);
  const sessionId = context.get(sessionIdContext);
  if (action.type === "mark_displayed") {
    const activity = context.get(sessionActivitySourceContext);
    return await activity.markMessageDisplayed(sessionId, action.messageKey);
  }
  const executor = context.get(sessionExecutorContext);
  if (action.type === "abort") {
    await executor.abort(sessionId);
    return;
  }
  const input = {
    text: action.text,
    model: action.model,
    thinkingLevel: action.thinkingLevel,
  };
  if (action.type === "prompt") {
    await executor.prompt(sessionId, input);
  } else if (action.type === "steer") {
    await executor.steer(sessionId, input);
  } else if (action.type === "follow-up") {
    await executor.followUp(sessionId, input);
  }
}
