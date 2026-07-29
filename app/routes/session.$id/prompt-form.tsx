import type { Model, Api } from "@earendil-works/pi-ai";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SendIcon } from "lucide-react";
import { Select } from "radix-ui";
import { useEffect, useRef, useState } from "react";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

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
  onSubmit: (text: string) => void;
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
    if (!text || isStreaming) return;
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
          placeholder={
            isStreaming ? "Pi is thinking…" : "Type a message… (Ctrl+Enter to send)"
          }
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
              disabled={!input.trim() || isStreaming}
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
function SelectPicker({
  value,
  onValueChange,
  trigger,
  triggerClassName = "",
  contentClassName = "",
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
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
 * Prompt form. Owns model / thinking-level selection, delegates input to
 * MessageInput so the Select components stay isolated from typing.
 */
export function PromptForm({
  isStreaming,
  models,
  defaultModel,
  defaultThinkingLevel,
  onSend,
}: {
  isStreaming: boolean;
  models: readonly Model<Api>[];
  defaultModel: { provider: string; modelId: string } | null;
  defaultThinkingLevel: string;
  onSend: (
    text: string,
    model: { provider: string; modelId: string } | null,
    thinkingLevel: string,
  ) => void;
}) {
  const [selectedModel, setSelectedModel] = useState<{ provider: string; modelId: string } | null>(
    defaultModel,
  );
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState(defaultThinkingLevel);

  // Sync with parent defaults when they change (e.g., session switch)
  useEffect(() => {
    setSelectedModel(defaultModel);
  }, [defaultModel]);

  useEffect(() => {
    setSelectedThinkingLevel(defaultThinkingLevel);
  }, [defaultThinkingLevel]);

  function handleSubmit(text: string) {
    onSend(text, selectedModel, selectedThinkingLevel);
  }

  // Group models by provider for the select
  const groupedModels = models.reduce<Array<{ provider: string; models: typeof models }>>(
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

  const selectedModelValue = selectedModel
    ? `${selectedModel.provider}\n\n${selectedModel.modelId}`
    : "";

  return (
    <MessageInput isStreaming={isStreaming} onSubmit={handleSubmit}>
      {/* Model selector */}
      <SelectPicker
        value={selectedModelValue}
        onValueChange={(value) => {
          const sepIdx = value.indexOf("\n\n");
          const provider = value.slice(0, sepIdx);
          const modelId = value.slice(sepIdx + 1);
          setSelectedModel({ provider, modelId });
        }}
        trigger={
          <Select.Value>
            {selectedModel
              ? (models.find(
                  (m) => m.provider === selectedModel.provider && m.id === selectedModel.modelId,
                )?.name ?? selectedModel.modelId)
              : "Select Model"}
          </Select.Value>
        }
        contentClassName="max-h-64"
      >
        {models.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-500">No models available</div>
        ) : (
          groupedModels.map((group) => (
            <Select.Group key={group.provider}>
              <Select.Label className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 tracking-wider">
                {group.provider}
              </Select.Label>
              {group.models.map((m) => {
                const value = `${m.provider}\n\n${m.id}`;
                return (
                  <Select.Item
                    key={value}
                    value={value}
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
          ))
        )}
      </SelectPicker>

      {/* Thinking level selector */}
      <SelectPicker
        value={selectedThinkingLevel}
        onValueChange={setSelectedThinkingLevel}
        trigger={<Select.Value />}
        triggerClassName="capitalize"
        contentClassName="min-w-28"
      >
        {THINKING_LEVELS.map((level) => (
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
}
