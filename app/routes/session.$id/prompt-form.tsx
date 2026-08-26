import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SendIcon, Square } from "lucide-react";
import { Select } from "radix-ui";
import { memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Await } from "react-router";
import { css, cx } from "styled-system/css";

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ModelThinkingLevel[];

const inputShellStyle = css({
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  maxWidth: "5xl",
  marginInline: "auto",
  paddingInline: "4",
  paddingBottom: "4",
  paddingTop: "2",
});

const cardStyle = css({
  backgroundColor: "bg.card",
  borderRadius: "xl",
  boxShadow: "overlay",
  borderWidth: "1px",
  borderColor: "border",
  padding: "4",
});

const textareaStyle = css({
  width: "full",
  resize: "none",
  backgroundColor: "transparent",
  _focus: { outline: "none" },
  _disabled: { opacity: 0.5, cursor: "not-allowed" },
  overflow: "hidden",
  maxHeight: "15rem",
});

const sendButtonStyle = css({
  backgroundColor: "action",
  color: "white",
  borderRadius: "lg",
  padding: "1.5",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  _hover: { backgroundColor: "action.hover" },
  _disabled: {
    backgroundColor: { base: "gray.300", _dark: "gray.700" },
    cursor: "not-allowed",
  },
});

const abortButtonStyle = css({
  backgroundColor: { base: "red.600", _dark: "red.600" },
  color: "white",
  borderRadius: "lg",
  padding: "1.5",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  _hover: { backgroundColor: { base: "red.700", _dark: "red.700" } },
});

const selectTriggerStyle = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "1",
  textStyle: "xs",
  paddingInline: "2.5",
  paddingBlock: "1",
  borderRadius: "full",
  _hover: { backgroundColor: { base: "gray.100", _dark: "gray.700" } },
});

const selectContentStyle = css({
  zIndex: 50,
  backgroundColor: "bg.card",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "xl",
  boxShadow: "lg",
  overflow: "hidden",
});

const selectScrollButtonStyle = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "6",
});

const selectItemStyle = css({
  position: "relative",
  display: "flex",
  alignItems: "center",
  paddingInline: "8",
  paddingBlock: "2",
  textStyle: "sm",
  borderRadius: "lg",
  outline: "none",
  cursor: "pointer",
  userSelect: "none",
  _highlighted: {
    backgroundColor: { base: "blue.100", _dark: "blue.900/50" },
    color: { base: "blue.700", _dark: "blue.300" },
  },
});

const itemIndicatorStyle = css({
  position: "absolute",
  left: "2",
  display: "inline-flex",
  alignItems: "center",
});

const emptyMessageStyle = css({
  paddingInline: "3",
  paddingBlock: "2",
  textStyle: "sm",
  color: "gray.500",
});

const groupLabelStyle = css({
  paddingInline: "2",
  paddingBlock: "1.5",
  textStyle: "xs",
  fontWeight: "semibold",
  color: "fg.muted",
  letterSpacing: "0.05em",
});

/** A model selection summarized by the parts the UI needs to render. */
export interface SelectedModel {
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
  onAbort,
  children,
}: {
  isStreaming: boolean;
  onSubmit?: (text: string) => void;
  onAbort: () => void;
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
    <div className={inputShellStyle}>
      <div className={cardStyle}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? "Pi is thinking…" : "Type a message… (Ctrl+Enter to send)"}
          disabled={isStreaming}
          rows={1}
          className={textareaStyle}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = el.scrollHeight + "px";
          }}
        />
        <div className={css({ display: "flex", alignItems: "center", gap: "2", marginTop: "3" })}>
          {children}
          <div className={css({ marginLeft: "auto" })}>
            {isStreaming ? (
              <button
                onClick={onAbort}
                aria-label="Abort"
                title="Abort"
                className={abortButtonStyle}
              >
                <Square className={css({ width: "4", height: "4" })} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!onSubmit || !input.trim()}
                className={sendButtonStyle}
              >
                <SendIcon className={css({ width: "4", height: "4" })} strokeWidth={2} />
              </button>
            )}
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
      <Select.Trigger className={cx(selectTriggerStyle, triggerClassName)}>
        {trigger}
        <ChevronDownIcon className={css({ width: "3", height: "3" })} />
      </Select.Trigger>
      <Select.Content
        position="popper"
        side="top"
        align="start"
        className={cx(selectContentStyle, contentClassName)}
      >
        <Select.ScrollUpButton className={selectScrollButtonStyle}>
          <ChevronUpIcon className={css({ width: "4", height: "4" })} />
        </Select.ScrollUpButton>
        <Select.Viewport className={css({ padding: "1" })}>{children}</Select.Viewport>
        <Select.ScrollDownButton className={selectScrollButtonStyle}>
          <ChevronDownIcon className={css({ width: "4", height: "4" })} />
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
    return <div className={emptyMessageStyle}>No models available</div>;
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
          <Select.Label className={groupLabelStyle}>{group.provider}</Select.Label>
          {group.models.map((m) => {
            const value = serializeModelName({ provider: m.provider, modelId: m.id });
            return (
              <Select.Item
                key={value}
                value={value}
                onSelect={() => onSelect({ name: m.name, provider: m.provider, id: m.id })}
                className={selectItemStyle}
              >
                <Select.ItemText>
                  <div className={css({ display: "flex", flexDirection: "column" })}>
                    <span className={css({ fontWeight: "medium" })}>{m.name}</span>
                    <span className={`${css({ textStyle: "xs", color: "fg.subtle" })} font-mono`}>
                      {m.id}
                    </span>
                  </div>
                </Select.ItemText>
                <Select.ItemIndicator className={itemIndicatorStyle}>
                  <CheckIcon className={css({ width: "4", height: "4" })} />
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
  onAbort: () => void;
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
  onAbort,
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
    <MessageInput
      isStreaming={isStreaming}
      onSubmit={selectedModel ? handleSubmit : undefined}
      onAbort={onAbort}
    >
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
        contentClassName={css({ maxHeight: "16rem" })}
      >
        <Suspense
          fallback={
            <div className={emptyMessageStyle} aria-busy="true">
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
        triggerClassName={css({ textTransform: "capitalize" })}
        contentClassName={css({ minWidth: "7rem" })}
      >
        {availableThinkingLevels.map((level) => (
          <Select.Item
            key={level}
            value={level}
            className={cx(selectItemStyle, css({ textTransform: "capitalize" }))}
          >
            <Select.ItemText>{level}</Select.ItemText>
            <Select.ItemIndicator className={itemIndicatorStyle}>
              <CheckIcon className={css({ width: "4", height: "4" })} />
            </Select.ItemIndicator>
          </Select.Item>
        ))}
      </SelectPicker>
    </MessageInput>
  );
});

function ModelLoadError() {
  return (
    <div
      className={css({ paddingInline: "3", paddingBlock: "2", textStyle: "sm", color: "danger" })}
    >
      Failed to load models
    </div>
  );
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
