import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SendIcon } from "lucide-react";
import { Select } from "radix-ui";
import { memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Await } from "react-router";

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ModelThinkingLevel[];

/** A model selection summarized by the parts the UI needs to render. */
interface SelectedModel {
  name: string;
  provider: string;
  id: string;
}

/**
 * Textarea + send button. Manages `input` state locally so that typing
 * does not re-render sibling Select components.
 */
function MessageInput({
  isStreaming,
  onSubmit,
  children,
}: {
  isStreaming: boolean;
  onSubmit?: (text: string) => void;
  children?: React.ReactNode;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset textarea height when input becomes empty after submission
  useEffect(() => {
    if (!input && inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [input]);

  function handleSubmit() {
    const text = input.trim();
    if (!onSubmit || !text || isStreaming) return;
    setInput("");
    onSubmit(text);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 max-w-5xl mx-auto px-4 pb-4 pt-2">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-[0_4px_10px_-4px_rgba(0,0,0,0.15)] border border-gray-200 dark:border-gray-700 p-4">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? "Pi is thinking…" : "Type a message… (Ctrl+Enter to send)"}
          disabled={isStreaming}
          rows={1}
          className="w-full resize-none bg-transparent text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden max-h-60"
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = el.scrollHeight + "px";
          }}
        />
        <div className="flex items-center gap-2 mt-3">
          {children}
          <div className="ml-auto">
            <button
              onClick={handleSubmit}
              disabled={!onSubmit || !input.trim() || isStreaming}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed"
            >
              <SendIcon className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shared Radix UI Select wrapper used by both the model and thinking-level selectors. */
function SelectPicker<T extends string>({
  value,
  onValueChange,
  trigger,
  triggerClassName = "",
  contentClassName = "",
  children,
}: {
  value?: T;
  onValueChange: (value: T) => void;
  trigger: React.ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full ${triggerClassName}`}
      >
        {trigger}
        <ChevronDownIcon className="w-3 h-3" />
      </Select.Trigger>
      <Select.Content
        position="popper"
        side="top"
        align="start"
        className={`z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden ${contentClassName}`}
      >
        <Select.ScrollUpButton className="flex items-center justify-center h-6">
          <ChevronUpIcon className="w-4 h-4" />
        </Select.ScrollUpButton>
        <Select.Viewport className="p-1">{children}</Select.Viewport>
        <Select.ScrollDownButton className="flex items-center justify-center h-6">
          <ChevronDownIcon className="w-4 h-4" />
        </Select.ScrollDownButton>
      </Select.Content>
    </Select.Root>
  );
}

/**
 * Renders the model list options once the streamed `models` promise resolves,
 * and pushes the resolved list up to the parent so the thinking-level selector
 * can reflect the selected model's supported levels.
 */
function ModelListItems({
  models,
  onSelect,
  onResolved,
}: {
  models: readonly Model<Api>[];
  onSelect: (model: SelectedModel) => void;
  onResolved: (models: readonly Model<Api>[]) => void;
}) {
  // Surface the resolved list to the parent (runs client-side after hydration
  // and whenever the promise settles).
  useEffect(() => {
    onResolved(models);
  }, [models, onResolved]);

  if (models.length === 0) {
    return <div className="px-3 py-2 text-sm text-gray-500">No models available</div>;
  }

  const groupedModels = models.reduce<Array<{ provider: string; models: readonly Model<Api>[] }>>(
    (acc, m) => {
      const existing = acc.find((g) => g.provider === m.provider);
      if (existing) {
        existing.models = [...existing.models, m];
      } else {
        acc.push({ provider: m.provider, models: [m] });
      }
      return acc;
    },
    [],
  );

  return (
    <>
      {groupedModels.map((group) => (
        <Select.Group key={group.provider}>
          <Select.Label className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 tracking-wider">
            {group.provider}
          </Select.Label>
          {group.models.map((m) => {
            const value = serializeModelName({ provider: m.provider, modelId: m.id });
            return (
              <Select.Item
                key={value}
                value={value}
                onSelect={() => onSelect({ name: m.name, provider: m.provider, id: m.id })}
                className="relative flex items-center px-8 py-2 text-sm rounded-lg data-highlighted:bg-blue-100 dark:data-highlighted:bg-blue-900/50 data-highlighted:text-blue-700 dark:data-highlighted:text-blue-300 cursor-pointer select-none outline-none"
              >
                <Select.ItemText>
                  <div className="flex flex-col">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                      {m.id}
                    </span>
                  </div>
                </Select.ItemText>
                <Select.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <CheckIcon className="w-4 h-4" />
                </Select.ItemIndicator>
              </Select.Item>
            );
          })}
        </Select.Group>
      ))}
    </>
  );
}

export interface PromptFormProps {
  isStreaming: boolean;
  models: Promise<readonly Model<Api>[]>;
  defaultModel: SelectedModel | null;
  defaultThinkingLevel: ModelThinkingLevel;
  onSend: (
    text: string,
    model: { provider: string; modelId: string },
    thinkingLevel: ModelThinkingLevel,
  ) => void;
}

/**
 * Prompt form. Owns model / thinking-level selection, delegates input to
 * MessageInput so the Select components stay isolated from typing.
 *
 * Memoized: while the session streams, the Chat route re-renders on every
 * token (its message list updates), but the model list and selection props do
 * not change, so the whole selector tree must not re-render either.
 *
 * The model list arrives as a promise from the loader. The closed trigger only
 * depends on `selectedModel` (seeded from the session's default model), so it
 * renders the default model regardless of whether the list has loaded yet.
 * Only the open dropdown resolves the promise via <Await> and shows a
 * "Loading..." fallback until it settles.
 */
export const PromptForm = memo(function PromptForm({
  isStreaming,
  models,
  defaultModel,
  defaultThinkingLevel,
  onSend,
}: PromptFormProps) {
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(defaultModel);
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState(defaultThinkingLevel);
  // Latest resolved model list, fed by <ModelListItems> once the wrapped
  // promise settles. Used to look up the selected model's specs.
  const [resolvedModels, setResolvedModels] = useState<readonly Model<Api>[] | null>(null);

  const handleModelsResolved = useCallback((resolved: readonly Model<Api>[]) => {
    setResolvedModels(resolved);
  }, []);

  const handleSelectModel = useCallback((model: SelectedModel) => {
    setSelectedModel(model);
  }, []);

  // Keep the thinking level within the selected model's supported range once
  // its specs are known — covers both the initial default model and any
  // subsequent selection made through the dropdown.
  useEffect(() => {
    if (!resolvedModels || !selectedModel) return;
    const spec = resolvedModels.find(
      (m) => m.provider === selectedModel.provider && m.id === selectedModel.id,
    );
    if (spec) setSelectedThinkingLevel((prev) => clampThinkingLevel(spec, prev));
  }, [resolvedModels, selectedModel]);

  function handleSubmit(text: string) {
    if (!selectedModel) return;
    onSend(
      text,
      { provider: selectedModel.provider, modelId: selectedModel.id },
      selectedThinkingLevel,
    );
  }

  const selectedSpec =
    resolvedModels?.find(
      (m) => m.provider === selectedModel?.provider && m.id === selectedModel?.id,
    ) ?? null;

  // Only offer thinking levels the selected model actually supports.
  const availableThinkingLevels = selectedSpec
    ? getSupportedThinkingLevels(selectedSpec)
    : THINKING_LEVELS;

  const selectedModelValue = selectedModel
    ? serializeModelName({ provider: selectedModel.provider, modelId: selectedModel.id })
    : "";

  return (
    <MessageInput isStreaming={isStreaming} onSubmit={selectedModel ? handleSubmit : undefined}>
      {/* Model selector — the trigger is decoupled from the models promise so
          it always shows the default model; only the open dropdown waits. */}
      <SelectPicker
        value={selectedModelValue}
        onValueChange={(value) => {
          const { provider, modelId } = deserializeModelName(value);
          // Prefer the display name when the list is loaded; fall back to the
          // id so the closed trigger stays meaningful.
          const spec = resolvedModels?.find((m) => m.provider === provider && m.id === modelId);
          handleSelectModel({ name: spec?.name ?? modelId, provider, id: modelId });
        }}
        trigger={<Select.Value>{selectedModel ? selectedModel.name : "Select Model"}</Select.Value>}
        contentClassName="max-h-64"
      >
        <Suspense
          fallback={
            <div className="px-3 py-2 text-sm text-gray-500" aria-busy="true">
              Loading...
            </div>
          }
        >
          <Await resolve={models} errorElement={<ModelLoadError />}>
            {(resolved) => (
              <ModelListItems
                models={resolved}
                onSelect={handleSelectModel}
                onResolved={handleModelsResolved}
              />
            )}
          </Await>
        </Suspense>
      </SelectPicker>

      {/* Thinking level selector */}
      <SelectPicker
        value={selectedThinkingLevel}
        onValueChange={setSelectedThinkingLevel}
        trigger={<Select.Value />}
        triggerClassName="capitalize"
        contentClassName="min-w-28"
      >
        {availableThinkingLevels.map((level) => (
          <Select.Item
            key={level}
            value={level}
            className="relative flex items-center px-8 py-2 text-sm rounded-lg capitalize data-highlighted:bg-blue-100 dark:data-highlighted:bg-blue-900/50 data-highlighted:text-blue-700 dark:data-highlighted:text-blue-300 cursor-pointer select-none outline-none"
          >
            <Select.ItemText>{level}</Select.ItemText>
            <Select.ItemIndicator className="absolute left-2 inline-flex items-center">
              <CheckIcon className="w-4 h-4" />
            </Select.ItemIndicator>
          </Select.Item>
        ))}
      </SelectPicker>
    </MessageInput>
  );
});

function ModelLoadError() {
  return <div className="px-3 py-2 text-sm text-red-600">Failed to load models</div>;
}

function serializeModelName(model: { provider: string; modelId: string }): string {
  return `${model.provider}\0${model.modelId}`;
}

function deserializeModelName(value: string): { provider: string; modelId: string } {
  const sepIdx = value.indexOf("\0");
  return {
    provider: value.slice(0, sepIdx),
    modelId: value.slice(sepIdx + 1),
  };
}
