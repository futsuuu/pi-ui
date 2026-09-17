import { clampThinkingLevel, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { Menu } from "lucide-react";
import { useCallback } from "react";
import { redirect, useFetcher, useOutletContext } from "react-router";
import * as v from "valibot";

import { agentSessionContainerContext, modelRuntimeContext } from "~/router-contexts";

import { PromptForm } from "../session.$id/prompt-form";
import type { SessionOutletContext } from "../session/route";
import type { Route } from "./+types/route";

const ActionSchema = v.object({
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
});

type ActionInput = v.InferInput<typeof ActionSchema>;

function requestedDirectory(request: Request): string {
  const dir = new URL(request.url).searchParams.get("dir");
  if (!dir) throw redirect("/");
  return dir;
}

async function waitForPromptStart(session: AgentSession, text: string): Promise<void> {
  let resolveStart!: () => void;
  let rejectStart!: (error: unknown) => void;
  const started = new Promise<void>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });
  const completion = session.prompt(text, {
    preflightResult: (accepted) => {
      if (accepted) resolveStart();
      else rejectStart(new Error("Prompt was rejected before starting"));
    },
  });
  void completion.then(
    () => rejectStart(new Error("Prompt completed before starting")),
    rejectStart,
  );
  await started;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const dir = requestedDirectory(request);
  const modelRuntime = context.get(modelRuntimeContext);
  const models = modelRuntime.getAvailable();
  const availableModels = await models;
  const settings = SettingsManager.create(dir, getAgentDir());
  const configuredModel = availableModels.find(
    (model) =>
      model.provider === settings.getDefaultProvider() && model.id === settings.getDefaultModel(),
  );
  const model = configuredModel ?? availableModels[0] ?? null;
  const requestedThinkingLevel = model
    ? (settings.getModelThinkingLevel(model.provider, model.id) ??
      settings.getDefaultThinkingLevel() ??
      "medium")
    : "off";
  return {
    dir,
    models,
    defaultModel: model
      ? {
          name: model.name,
          provider: model.provider,
          id: model.id,
        }
      : null,
    defaultThinkingLevel: model
      ? clampThinkingLevel(model, requestedThinkingLevel)
      : requestedThinkingLevel,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const dir = requestedDirectory(request);
  const input = v.parse(ActionSchema, await request.json());
  const container = context.get(agentSessionContainerContext);
  const modelRuntime = context.get(modelRuntimeContext);
  const session = await container.create(dir);
  let started = false;
  try {
    const model = modelRuntime.getModel(input.model.provider, input.model.id);
    if (!model) {
      throw new Error(
        `Model ${JSON.stringify(`${input.model.provider}/${input.model.id}`)} not found`,
      );
    }
    await session.setModel(model);
    session.setThinkingLevel(input.thinkingLevel);
    await waitForPromptStart(session, input.text);
    started = true;
    return redirect(`/session/${encodeURIComponent(session.sessionId)}`);
  } finally {
    if (!started) await container.dispose(session.sessionId);
  }
}

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - New Session" }];
}

export default function NewSession({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher<typeof action>();
  const { openSidebar } = useOutletContext<SessionOutletContext>();
  const sendMessage = useCallback(
    (
      text: string,
      model: { provider: string; modelId: string },
      thinkingLevel: ModelThinkingLevel,
    ) => {
      void fetcher.submit(
        {
          text,
          model: { provider: model.provider, id: model.modelId },
          thinkingLevel,
        } satisfies ActionInput,
        {
          method: "post",
          encType: "application/json",
          action: `/session/new?dir=${encodeURIComponent(loaderData.dir)}`,
        },
      );
    },
    [fetcher, loaderData.dir],
  );

  return (
    <div className="h-full flex flex-col relative">
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-2">
          <button
            type="button"
            aria-label="Open sidebar"
            onClick={openSidebar}
            className="rounded-lg p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium">New Session</span>
        </div>
      </div>
      <PromptForm
        isStreaming={false}
        disabled={fetcher.state !== "idle"}
        models={loaderData.models}
        defaultModel={loaderData.defaultModel}
        defaultThinkingLevel={loaderData.defaultThinkingLevel}
        onSend={sendMessage}
        onAbort={() => undefined}
      />
    </div>
  );
}
