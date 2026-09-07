import { ArrowRight, ExternalLink } from "lucide-react";
import { Dialog, RadioGroup } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigate, useRevalidator } from "react-router";

import type {
  AuthTypeDto,
  OperationSnapshot,
  PromptSnapshot,
  ProviderStatusDto,
} from "~/provider-auth-manager";

export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function describeSource(status: ProviderStatusDto): string | null {
  if (status.registration !== "registered" || !status.effectiveAuth?.source) return null;
  const { kind, label } = status.effectiveAuth.source;
  switch (kind) {
    case "stored":
      return "Stored credential";
    case "runtime":
      return "Runtime override";
    case "environment":
      return label ?? "Environment variable";
    case "fallback":
      return label ?? "Fallback";
    case "models_json_key":
      return "models.json key";
    case "models_json_command":
      return "models.json command";
  }
}

export function filterProviders(
  providers: readonly ProviderStatusDto[],
  query: string,
): readonly ProviderStatusDto[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return providers;
  return providers.filter(
    (provider) =>
      provider.name.toLowerCase().includes(normalized) ||
      provider.id.toLowerCase().includes(normalized),
  );
}

export function ProviderList({
  providers,
  onStartLogin,
  onStartRemoval,
  startPending,
}: {
  providers: readonly ProviderStatusDto[];
  onStartLogin: (providerId: string, authType: AuthTypeDto) => void;
  onStartRemoval: (providerId: string) => void;
  startPending: string | null;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <ul className="mt-3 space-y-3">
      {providers.map((provider) => {
        const configured =
          provider.registration === "registered" && provider.effectiveAuth !== null;
        const source = describeSource(provider);
        const stored = provider.storedCredential;
        const isConfirming = confirming === provider.id;
        return (
          <li
            key={provider.id}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <span className="text-sm font-medium">{provider.name}</span>{" "}
                <span className="text-xs text-gray-500">{provider.id}</span>
              </div>
              <span className="text-xs">{configured ? "Configured" : "Not configured"}</span>
            </div>
            {source ? <p className="mt-1 text-xs text-gray-500">{source}</p> : null}
            <p className="mt-1 text-xs text-gray-500">
              {stored
                ? `Stored: ${stored.type === "oauth" ? "OAuth" : "API key"}`
                : "No stored credential"}
            </p>
            {provider.registration === "registered" && provider.methods.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {provider.methods.map((method) => (
                  <button
                    key={method.type}
                    type="button"
                    disabled={startPending !== null}
                    onClick={() => onStartLogin(provider.id, method.type)}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    {method.label}
                  </button>
                ))}
              </div>
            ) : null}
            {provider.registration === "orphaned" ? (
              <p className="mt-1 text-xs text-gray-500">
                Provider is no longer registered. The stored credential can still be removed.
              </p>
            ) : null}
            {stored ? (
              <div className="mt-2">
                {isConfirming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      Remove the stored credential? Environment variables, cloud credentials, and
                      models.json are not affected.
                    </span>
                    <button
                      type="button"
                      disabled={startPending !== null}
                      onClick={() => {
                        setConfirming(null);
                        onStartRemoval(provider.id);
                      }}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      Confirm remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={startPending !== null}
                    onClick={() => setConfirming(provider.id)}
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ProviderAuthSection({
  providers,
  onStartLogin,
  onStartRemoval,
  startPending,
  conflictOperationId,
}: {
  providers: readonly ProviderStatusDto[];
  onStartLogin: (providerId: string, authType: AuthTypeDto) => void;
  onStartRemoval: (providerId: string) => void;
  startPending: string | null;
  conflictOperationId: string | null;
}) {
  const [query, setQuery] = useState("");
  const filtered = filterProviders(providers, query);
  return (
    <section aria-label="Provider authentication" className="mt-6">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Provider authentication
          </h2>
          <input
            type="search"
            aria-label="Search providers"
            placeholder="Search providers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-sm"
          />
        </div>
        {conflictOperationId ? (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
            Another operation is already running.{" "}
            <Link
              to={`/settings?authOperation=${encodeURIComponent(conflictOperationId)}`}
              className="underline"
            >
              View active operation
            </Link>
          </p>
        ) : null}
        <ProviderList
          providers={filtered}
          onStartLogin={onStartLogin}
          onStartRemoval={onStartRemoval}
          startPending={startPending}
        />
        {filtered.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No providers match.</p>
        ) : null}
      </div>
    </section>
  );
}

function AuthDialogFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Dialog.Root open modal onOpenChange={() => {}}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-black/40"
          onClick={(event) => event.preventDefault()}
        />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <Dialog.Content
            aria-describedby={undefined}
            onInteractOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => event.preventDefault()}
            className="pointer-events-auto w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </Dialog.Title>
            </div>
            <div className="mt-3">{children}</div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PromptForm({
  prompt,
  answerPending,
  cancelPending,
  onAnswer,
  onCancel,
}: {
  prompt: PromptSnapshot;
  answerPending: boolean;
  cancelPending: boolean;
  onAnswer: (promptId: number, answer: string) => void;
  onCancel: () => void;
}) {
  const [textValue, setTextValue] = useState("");
  const [selectValue, setSelectValue] = useState(
    prompt.type === "select" ? (prompt.options?.[0]?.id ?? "") : "",
  );
  return (
    <form
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        const value = prompt.type === "select" ? selectValue : textValue;
        if (!value) return;
        onAnswer(prompt.id, value);
        setTextValue("");
      }}
    >
      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{prompt.message}</p>
        {prompt.type === "select" ? (
          <RadioGroup.Root
            aria-label={prompt.message}
            value={selectValue}
            onValueChange={setSelectValue}
            className="mt-2 space-y-2"
          >
            {prompt.options?.map((option) => (
              <label key={option.id} className="flex cursor-pointer items-start gap-2 py-1 text-sm">
                <RadioGroup.Item
                  value={option.id}
                  id={`prompt-${prompt.id}-${option.id}`}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-gray-300 dark:border-gray-600 data-[state=checked]:border-blue-600"
                >
                  <RadioGroup.Indicator className="flex h-full w-full items-center justify-center after:block after:h-2 after:w-2 after:rounded-full after:bg-blue-600" />
                </RadioGroup.Item>
                <span>
                  <span className="block">{option.label}</span>
                  {option.description ? (
                    <span className="block text-xs text-gray-500">{option.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </RadioGroup.Root>
        ) : prompt.type === "secret" ? (
          <input
            type="password"
            aria-label={prompt.message}
            value={textValue}
            placeholder={prompt.placeholder}
            onChange={(event) => setTextValue(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-sm"
          />
        ) : (
          <input
            type="text"
            aria-label={prompt.message}
            value={textValue}
            placeholder={prompt.placeholder}
            onChange={(event) => setTextValue(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-sm"
          />
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={cancelPending}
          onClick={onCancel}
          className="w-20 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          aria-label="Submit"
          disabled={answerPending || (prompt.type === "select" ? !selectValue : !textValue)}
          className="flex w-20 items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}

export function AuthDialogView({
  snapshot,
  answerPending,
  cancelPending,
  onAnswer,
  onCancel,
  onDismiss,
}: {
  snapshot: OperationSnapshot;
  answerPending: boolean;
  cancelPending: boolean;
  onAnswer: (promptId: number, answer: string) => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  if (snapshot.kind === "removal") {
    if (snapshot.phase === "running") {
      return (
        <AuthDialogFrame title={`Remove ${snapshot.providerName}`}>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Removing stored credential for {snapshot.providerName}…
          </p>
        </AuthDialogFrame>
      );
    }
    return (
      <AuthDialogFrame title={`Remove ${snapshot.providerName}`}>
        {snapshot.outcome === "success" ? (
          <p className="text-sm">Stored credential removed.</p>
        ) : null}
        {snapshot.outcome === "warning" ? (
          <p className="text-sm">Stored credential removed, but local state did not synchronize.</p>
        ) : null}
        {snapshot.outcome === "failure" ? (
          <p role="alert" className="text-sm text-red-700">
            {snapshot.message ?? "Removal failed."}
          </p>
        ) : null}
        {snapshot.outcome !== "failure" ? (
          <p className="mt-1 text-xs text-gray-500">
            If the provider still shows as configured, another source such as an environment
            variable, runtime override, or models.json is providing authentication.
          </p>
        ) : null}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      </AuthDialogFrame>
    );
  }
  const events = snapshot.events;
  return (
    <AuthDialogFrame title={`Sign in to ${snapshot.providerName}`}>
      <div className="space-y-2">
        {snapshot.phase === "terminal"
          ? null
          : events.map((event, index) => {
              switch (event.type) {
                case "info":
                  return (
                    <div key={index} className="text-sm">
                      <p>{event.message}</p>
                      {event.links?.map((link) =>
                        isSafeHttpUrl(link.url) ? (
                          <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 underline"
                          >
                            {link.label ?? link.url}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null,
                      )}
                    </div>
                  );
                case "auth_url":
                  return (
                    <div key={index} className="text-sm">
                      {event.instructions ? <p>{event.instructions}</p> : null}
                      {isSafeHttpUrl(event.url) ? (
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 underline"
                        >
                          Open authorization link
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  );
                case "device_code":
                  return (
                    <div key={index} className="space-y-1 text-sm">
                      <p>
                        User code: <code>{event.userCode}</code>
                      </p>
                      {isSafeHttpUrl(event.verificationUri) ? (
                        <a
                          href={event.verificationUri}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 underline"
                        >
                          Open verification link
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <p>{event.verificationUri}</p>
                      )}
                    </div>
                  );
                case "progress":
                  return (
                    <p key={index} className="text-sm text-gray-500">
                      {event.message}
                    </p>
                  );
              }
            })}
      </div>
      {snapshot.phase === "running" ? (
        <div className="mt-3">
          {snapshot.prompt ? (
            <PromptForm
              key={snapshot.prompt.id}
              prompt={snapshot.prompt}
              answerPending={answerPending}
              cancelPending={cancelPending}
              onAnswer={onAnswer}
              onCancel={onCancel}
            />
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500">Waiting for the provider…</p>
              <button
                type="button"
                disabled={cancelPending}
                onClick={onCancel}
                className="w-20 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : null}
      {snapshot.phase === "refreshing_catalog" ? (
        <p className="mt-3 text-sm text-gray-500">Refreshing model catalog…</p>
      ) : null}
      {snapshot.phase === "terminal" ? (
        <div className="mt-3">
          {snapshot.outcome === "success" ? <p className="text-sm">Signed in.</p> : null}
          {snapshot.outcome === "warning" ? (
            <p className="text-sm">
              Signed in with a warning: {snapshot.message ?? "Catalog refresh did not complete."}
            </p>
          ) : null}
          {snapshot.outcome === "failure" ? (
            <p role="alert" className="text-sm text-red-700">
              {snapshot.message ?? "Sign-in failed."}
            </p>
          ) : null}
          {snapshot.outcome === "cancelled" ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">Sign-in was cancelled.</p>
          ) : null}
          {snapshot.outcome === "timeout" ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">Sign-in timed out.</p>
          ) : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </AuthDialogFrame>
  );
}

function snapshotSignature(snapshot: OperationSnapshot): string {
  if (snapshot.kind === "removal") {
    return snapshot.phase === "terminal"
      ? `${snapshot.kind}:${snapshot.phase}:${snapshot.outcome}`
      : `${snapshot.kind}:${snapshot.phase}`;
  }
  const prompt = snapshot.phase === "running" ? (snapshot.prompt?.id ?? "none") : "";
  const outcome = snapshot.phase === "terminal" ? snapshot.outcome : "";
  return `${snapshot.kind}:${snapshot.phase}:${prompt}:${outcome}:${snapshot.events.length}`;
}

export function AuthOperationDialog({
  initial,
  onDismiss,
}: {
  initial: OperationSnapshot;
  onDismiss: () => void;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const revalidator = useRevalidator();
  const pollFetcher = useFetcher<{ operation: OperationSnapshot }>();
  const answerFetcher = useFetcher();
  const cancelFetcher = useFetcher();
  const revalidatedOperation = useRef<string | null>(null);
  const lastAnswerData = useRef<unknown>(null);
  const live = useRef({ pollFetcher, revalidator });
  useEffect(() => {
    live.current = { pollFetcher, revalidator };
  });
  useEffect(() => {
    setSnapshot((previous) =>
      previous.operationId === initial.operationId &&
      snapshotSignature(previous) === snapshotSignature(initial)
        ? previous
        : initial,
    );
  }, [initial]);
  const phase = snapshot.phase;
  const kind = snapshot.kind;
  useEffect(() => {
    if (phase === "terminal") {
      if (revalidatedOperation.current !== snapshot.operationId) {
        revalidatedOperation.current = snapshot.operationId;
        void live.current.revalidator.revalidate();
      }
      return;
    }
    const operationId = snapshot.operationId;
    const timer = setInterval(() => {
      void live.current.pollFetcher.load(`/settings/auth/${operationId}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [snapshot.operationId, phase, kind]);
  useEffect(() => {
    const next = (pollFetcher.data as { operation?: OperationSnapshot } | undefined)?.operation;
    if (
      next &&
      next.operationId === snapshot.operationId &&
      snapshotSignature(next) !== snapshotSignature(snapshot)
    ) {
      setSnapshot(next);
    }
  }, [pollFetcher.data, snapshot]);
  useEffect(() => {
    if (
      answerFetcher.state === "idle" &&
      answerFetcher.data &&
      lastAnswerData.current !== answerFetcher.data
    ) {
      lastAnswerData.current = answerFetcher.data;
      void pollFetcher.load(`/settings/auth/${snapshot.operationId}`);
    }
  }, [answerFetcher, pollFetcher, snapshot.operationId]);
  return (
    <AuthDialogView
      snapshot={snapshot}
      answerPending={answerFetcher.state !== "idle"}
      cancelPending={cancelFetcher.state !== "idle"}
      onAnswer={(promptId, answer) => {
        void answerFetcher.submit(
          { type: "answer", promptId, answer },
          {
            method: "post",
            action: `/settings/auth/${snapshot.operationId}`,
            encType: "application/json",
          },
        );
      }}
      onCancel={() => {
        void cancelFetcher.submit(
          { type: "cancel" },
          {
            method: "post",
            action: `/settings/auth/${snapshot.operationId}`,
            encType: "application/json",
          },
        );
        onDismiss();
      }}
      onDismiss={onDismiss}
    />
  );
}

export function SettingsAuthUI({
  providers,
  initialOperation,
}: {
  providers: readonly ProviderStatusDto[];
  initialOperation: OperationSnapshot | null;
}) {
  const startFetcher = useFetcher<{ error?: string; operationId?: string }>();
  const navigate = useNavigate();
  const [activeSnapshot, setActiveSnapshot] = useState<OperationSnapshot | null>(initialOperation);
  useEffect(() => {
    setActiveSnapshot(initialOperation);
  }, [initialOperation]);
  const conflictOperationId =
    startFetcher.data &&
    "operationId" in startFetcher.data &&
    startFetcher.data.error === "conflict"
      ? (startFetcher.data.operationId as string)
      : null;
  return (
    <>
      <ProviderAuthSection
        providers={providers}
        startPending={startFetcher.state !== "idle" ? "pending" : null}
        conflictOperationId={conflictOperationId}
        onStartLogin={(providerId, authType) => {
          void startFetcher.submit(
            { type: "start_login", providerId, authType },
            { method: "post", action: "/settings", encType: "application/json" },
          );
        }}
        onStartRemoval={(providerId) => {
          void startFetcher.submit(
            { type: "start_removal", providerId, confirmed: true },
            { method: "post", action: "/settings", encType: "application/json" },
          );
        }}
      />
      {activeSnapshot ? (
        <AuthOperationDialog
          initial={activeSnapshot}
          onDismiss={() => {
            setActiveSnapshot(null);
            void navigate("/settings", { replace: true });
          }}
        />
      ) : null}
    </>
  );
}
