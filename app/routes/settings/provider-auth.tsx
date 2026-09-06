import { useEffect, useState } from "react";
import { Link, useFetcher, useNavigate, useRevalidator } from "react-router";

import type { AuthTypeDto, OperationSnapshot, ProviderStatusDto } from "~/provider-auth-manager";

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
  const [textValue, setTextValue] = useState("");
  const [selectValue, setSelectValue] = useState("");
  const promptId =
    snapshot.kind === "login" && snapshot.phase === "running" ? snapshot.prompt?.id : undefined;
  useEffect(() => {
    setTextValue("");
    setSelectValue("");
  }, [promptId, snapshot.operationId]);
  if (snapshot.kind === "removal") {
    if (snapshot.phase === "running") {
      return (
        <div role="dialog" aria-label={`Remove ${snapshot.providerName}`} className="mt-4">
          <p className="text-sm">Removing stored credential for {snapshot.providerName}…</p>
        </div>
      );
    }
    return (
      <div role="dialog" aria-label={`Remove ${snapshot.providerName}`} className="mt-4">
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
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 rounded-lg border px-3 py-1.5 text-sm"
        >
          Close
        </button>
      </div>
    );
  }
  const events = snapshot.phase === "terminal" ? snapshot.events : snapshot.events;
  return (
    <div
      role="dialog"
      aria-label={`Sign in to ${snapshot.providerName}`}
      className="mt-4 rounded-lg border p-3"
    >
      <div className="space-y-2">
        {events.map((event, index) => {
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
                        className="underline"
                      >
                        {link.label ?? link.url}
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
                      className="underline"
                    >
                      Open authorization link
                    </a>
                  ) : null}
                </div>
              );
            case "device_code":
              return (
                <div key={index} className="text-sm">
                  <p>
                    Verification URL:{" "}
                    {isSafeHttpUrl(event.verificationUri) ? (
                      <a
                        href={event.verificationUri}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline"
                      >
                        {event.verificationUri}
                      </a>
                    ) : (
                      event.verificationUri
                    )}
                  </p>
                  <p>
                    User code: <code>{event.userCode}</code>{" "}
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(event.userCode)}
                      className="underline"
                    >
                      Copy code
                    </button>
                  </p>
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
            <form
              onSubmit={(formEvent) => {
                formEvent.preventDefault();
                if (!snapshot.prompt) return;
                const value = snapshot.prompt.type === "select" ? selectValue : textValue;
                if (!value) return;
                onAnswer(snapshot.prompt.id, value);
                setTextValue("");
                setSelectValue("");
              }}
            >
              <label className="block text-sm">
                {snapshot.prompt.message}
                {snapshot.prompt.type === "select" ? (
                  <select
                    aria-label={snapshot.prompt.message}
                    value={selectValue}
                    onChange={(event) => setSelectValue(event.target.value)}
                    className="mt-1 block w-full rounded border px-2 py-1.5"
                  >
                    <option value="">Select…</option>
                    {snapshot.prompt.options?.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : snapshot.prompt.type === "secret" ? (
                  <input
                    type="password"
                    aria-label={snapshot.prompt.message}
                    value={textValue}
                    placeholder={snapshot.prompt.placeholder}
                    onChange={(event) => setTextValue(event.target.value)}
                    className="mt-1 block w-full rounded border px-2 py-1.5"
                  />
                ) : (
                  <input
                    type="text"
                    aria-label={snapshot.prompt.message}
                    value={textValue}
                    placeholder={snapshot.prompt.placeholder}
                    onChange={(event) => setTextValue(event.target.value)}
                    className="mt-1 block w-full rounded border px-2 py-1.5"
                  />
                )}
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={
                    answerPending || (snapshot.prompt.type === "select" ? !selectValue : !textValue)
                  }
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Submit
                </button>
                <button
                  type="button"
                  disabled={cancelPending}
                  onClick={onCancel}
                  className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              disabled={cancelPending}
              onClick={onCancel}
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
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
            <p className="text-sm">Sign-in was cancelled.</p>
          ) : null}
          {snapshot.outcome === "timeout" ? <p className="text-sm">Sign-in timed out.</p> : null}
          <button
            type="button"
            onClick={onDismiss}
            className="mt-2 rounded border px-3 py-1.5 text-sm"
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AuthOperationDialog({ initial }: { initial: OperationSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const pollFetcher = useFetcher<{ operation: OperationSnapshot }>();
  const answerFetcher = useFetcher();
  const cancelFetcher = useFetcher();
  useEffect(() => {
    setSnapshot(initial);
  }, [initial]);
  const phase = snapshot.phase;
  const kind = snapshot.kind;
  useEffect(() => {
    if (phase === "terminal") {
      void revalidator.revalidate();
      return;
    }
    const timer = setInterval(() => {
      void pollFetcher.load(`/settings/auth/${snapshot.operationId}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [snapshot.operationId, phase, kind, pollFetcher, revalidator]);
  useEffect(() => {
    const next = (pollFetcher.data as { operation?: OperationSnapshot } | undefined)?.operation;
    if (next && next.operationId === snapshot.operationId) {
      setSnapshot(next);
    }
  }, [pollFetcher.data, snapshot.operationId]);
  useEffect(() => {
    if (answerFetcher.state === "idle" && answerFetcher.data) {
      void pollFetcher.load(`/settings/auth/${snapshot.operationId}`);
    }
  }, [answerFetcher.state, answerFetcher.data, snapshot.operationId, pollFetcher]);
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
      }}
      onDismiss={() => {
        void navigate("/settings", { replace: true });
      }}
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
      {activeSnapshot ? <AuthOperationDialog initial={activeSnapshot} /> : null}
    </>
  );
}
