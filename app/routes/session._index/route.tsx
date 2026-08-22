import path from "node:path";

import {
  ChevronRight,
  Dot,
  GitBranch,
  Layers,
  Loader2Icon,
  MessageCirclePlus,
  MoreVertical,
  Plus,
  Settings,
} from "lucide-react";
import { Collapsible } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { data, Link, redirect, useFetcher, useLoaderData } from "react-router";
import * as v from "valibot";

import { ActionsMenu, DeleteMenuItem } from "~/components/actions-menu";
import { useSessionEventsContext } from "~/contexts/session-events";
import {
  agentSessionContainerContext,
  projectRepositoryContext,
  worktreeRepositoryContext,
} from "~/router-contexts";
import type { Worktree } from "~/worktree-repository";

import type { Route } from "./+types/route";
import { useSessionList, type SessionListItem } from "./session-list";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Sessions" }];
}

const ActionSchema = v.variant("type", [
  v.object({
    type: v.literal("addWorktree"),
    dir: v.pipe(v.string(), v.minLength(1)),
  }),
  v.object({
    type: v.literal("deleteSession"),
    id: v.pipe(v.string(), v.minLength(1)),
    dir: v.pipe(v.string(), v.minLength(1)),
  }),
  v.object({
    type: v.literal("deleteWorktree"),
    dir: v.pipe(v.string(), v.minLength(1)),
    path: v.pipe(v.string(), v.minLength(1)),
  }),
]);

export type ActionInput = v.InferInput<typeof ActionSchema>;

type SessionWorktree = Worktree & {
  isMain: boolean;
  isManaged: boolean;
};

type WorktreeWithSessions = SessionWorktree & {
  sessions: SessionListItem[];
};

export async function action({ request, context }: Route.ActionArgs) {
  const worktreeRepository = context.get(worktreeRepositoryContext);
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return data({ error: "Invalid request" }, { status: 400 });
  }
  const result = v.safeParse(ActionSchema, parsed);
  if (!result.success) {
    return data({ error: "Invalid request" }, { status: 400 });
  }
  if (result.output.type === "addWorktree") {
    try {
      await worktreeRepository.add(result.output.dir);
      return { ok: true as const };
    } catch (error) {
      return data(
        { error: error instanceof Error ? error.message : "Failed to create worktree" },
        { status: 400 },
      );
    }
  }
  if (result.output.type === "deleteSession") {
    const sessionContainer = context.get(agentSessionContainerContext);
    try {
      await sessionContainer.delete(result.output.id, { cwd: result.output.dir });
      return { ok: true as const };
    } catch (error) {
      return data(
        { error: error instanceof Error ? error.message : "Failed to delete session" },
        { status: 400 },
      );
    }
  }
  if (result.output.type === "deleteWorktree") {
    const { dir, path: worktreePath } = result.output;
    try {
      // Client-supplied paths may use a different Windows spelling (8.3 short
      // names, case) than git reports; compare in canonical form.
      const canonicalPath = worktreeRepository.canonicalize(worktreePath);
      const worktrees = await worktreeRepository.list(dir);
      const worktree = worktrees.find((entry) => entry.path === canonicalPath);
      if (!worktree) {
        return data({ error: "Worktree not found" }, { status: 400 });
      }
      // Server-side guards: the main worktree is never deletable, and only
      // worktrees the app created (under its data dir) can be removed.
      if (path.resolve(canonicalPath) === path.resolve(await worktreeRepository.mainPath(dir))) {
        return data({ error: "Cannot delete the main worktree" }, { status: 400 });
      }
      if (!(await worktreeRepository.isManagedWorktreePath(dir, worktree.path))) {
        return data({ error: "Only app-managed worktrees can be deleted" }, { status: 400 });
      }
      // Sessions are stored outside the working tree (~/.pi/agent/sessions,
      // keyed by cwd), so delete them explicitly. Removing the worktree first
      // preserves the sessions if removal fails: a failed `git worktree
      // remove` (e.g. locked files on Windows) then leaves the worktree and
      // its chat history intact for a retry, rather than destroying the
      // history before the removal attempt.
      await worktreeRepository.remove(dir, worktree);
      const sessionContainer = context.get(agentSessionContainerContext);
      const sessions = await sessionContainer.listInfo(worktree.path);
      for (const session of sessions) {
        await sessionContainer.delete(session.id, { cwd: worktree.path });
      }
      return { ok: true as const };
    } catch (error) {
      return data(
        { error: error instanceof Error ? error.message : "Failed to delete worktree" },
        { status: 400 },
      );
    }
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const dir = url.searchParams.get("dir");
  if (!dir) {
    throw redirect("/");
  }
  const projectRepository = context.get(projectRepositoryContext);
  await projectRepository.add(dir);
  const worktreeRepository = context.get(worktreeRepositoryContext);
  // SessionManager stores session cwd values in canonical form. Use the same
  // form for the project root so sessions opened through a symlink or an
  // alternate path spelling are not filtered out of the list.
  const canonicalDir = worktreeRepository.canonicalize(dir);

  let worktrees: Worktree[] = [];
  try {
    worktrees = await worktreeRepository.list(dir);
  } catch {
    worktrees = [];
  }

  const mainBranch = await worktreeRepository.mainBranch(dir).catch(() => null);
  // Resolve the app's per-project worktree dir once instead of once per worktree.
  const projectWorktreeDir = await worktreeRepository.projectDir(dir);
  const managedPaths = new Set(
    (
      await Promise.all(
        worktrees.map(async (worktree) =>
          (await worktreeRepository.isManagedWorktreePath(dir, worktree.path, projectWorktreeDir))
            ? worktree.path
            : null,
        ),
      )
    ).filter((p): p is string => p !== null),
  );

  return {
    worktrees: [
      {
        branch: mainBranch ?? path.basename(dir),
        head: null,
        path: canonicalDir,
        isMain: true,
        isManaged: false,
      },
      ...worktrees.map((worktree) => ({
        ...worktree,
        isMain: false,
        isManaged: managedPaths.has(worktree.path),
      })),
    ],
    cwd: canonicalDir,
  };
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d ago`;
  if (diff < 30 * 86400000) return `${Math.floor(diff / (7 * 86400000))}w ago`;
  if (diff < 365 * 86400000) return `${Math.floor(diff / (30 * 86400000))}mo ago`;
  return d.toLocaleDateString();
}

function isAttentionSession(session: SessionListItem): boolean {
  return session.isStreaming || !session.isRead;
}

function SessionRow({
  session,
  deleting,
  onDelete,
}: {
  session: SessionListItem;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      className={`flex items-center rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 ${deleting ? "opacity-50 pointer-events-none" : ""}`}
    >
      <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
        {session.isStreaming ? (
          <Loader2Icon aria-label="Streaming" className="w-4 h-4 text-blue-500 animate-spin" />
        ) : (
          !session.isRead && (
            <Dot aria-label="Unread" className="w-4 h-4 fill-current text-blue-500" />
          )
        )}
      </span>
      <Link
        to={`/session/${encodeURIComponent(session.id)}`}
        className="min-w-0 flex-1 py-2 pl-2 text-left"
      >
        <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
          {session.firstMessage || "Untitled Session"}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {formatDate(session.timestamp)} · {session.messageCount} messages
        </p>
      </Link>
      <ActionsMenu
        ariaLabel="Session actions"
        trigger={<MoreVertical className="w-5 h-5" />}
        triggerClassName="p-1.5"
      >
        <DeleteMenuItem onSelect={onDelete} label="Delete Session" />
      </ActionsMenu>
    </div>
  );
}

function WorktreeGroup({
  worktree,
  onDeleteSession,
  onDeleteWorktree,
  isDeletingSession,
  isDeletingWorktree,
}: {
  worktree: WorktreeWithSessions;
  onDeleteSession: (session: SessionListItem) => void;
  onDeleteWorktree: (worktree: WorktreeWithSessions) => void;
  isDeletingSession: (sessionId: string) => boolean;
  isDeletingWorktree: (worktreePath: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const attentionSessions = worktree.sessions.filter(isAttentionSession);
  const branch = worktree.branch ?? worktree.head ?? "detached";
  const renderSession = (session: SessionListItem) => (
    <SessionRow
      key={session.id}
      session={session}
      deleting={isDeletingSession(session.id)}
      onDelete={() => onDeleteSession(session)}
    />
  );

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={`overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 ${isDeletingWorktree(worktree.path) ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div className="flex items-center justify-between gap-4 p-3">
        <Collapsible.Trigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 -m-1 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
          >
            <ChevronRight
              className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
            />
            <div className="min-w-0">
              <p className="font-mono text-sm text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
                {branch}
                {worktree.isMain && (
                  <span className="px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 text-[10px] font-sans font-medium uppercase tracking-wide flex-shrink-0">
                    main
                  </span>
                )}
                {worktree.branch === null && (
                  <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[10px] font-sans font-medium uppercase tracking-wide flex-shrink-0">
                    detached
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {worktree.sessions.length} {worktree.sessions.length === 1 ? "session" : "sessions"}
              </p>
            </div>
          </button>
        </Collapsible.Trigger>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link
            to={`/session/new?dir=${encodeURIComponent(worktree.path)}`}
            title="New Session"
            className="p-2 -m-1 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <MessageCirclePlus className="w-5 h-5" />
          </Link>
          <ActionsMenu
            ariaLabel="Worktree actions"
            trigger={<MoreVertical className="w-5 h-5" />}
            triggerClassName="p-1.5"
          >
            <DeleteMenuItem
              onSelect={() => onDeleteWorktree(worktree)}
              label="Delete Worktree"
              disabled={worktree.isMain || !worktree.isManaged}
            />
          </ActionsMenu>
        </div>
      </div>
      {worktree.sessions.length > 0 && (
        <Collapsible.Content>
          <div className="border-t border-gray-100 dark:border-gray-800/80 py-1 pl-3 pr-3">
            {worktree.sessions.map(renderSession)}
          </div>
        </Collapsible.Content>
      )}
      {!open && attentionSessions.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-800/80 py-1 pl-3 pr-3">
          {attentionSessions.map(renderSession)}
        </div>
      )}
    </Collapsible.Root>
  );
}

/**
 * Renders the session selection page with worktree management and session actions.
 */
export default function Sessions() {
  const { worktrees, cwd } = useLoaderData<typeof loader>();
  const { ready } = useSessionEventsContext();
  const fetcher = useFetcher<typeof action>();

  // Re-render once a minute so relative timestamps stay current even while
  // no stream event arrives (an idle session would otherwise freeze at e.g.
  // "5m ago").
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const sessionList = useSessionList(worktrees, cwd);
  const worktreesWithSessions = useMemo(
    () =>
      worktrees.map((worktree) => {
        const sessions = sessionList.filter((session) =>
          worktree.isMain ? session.worktree === null : session.worktree?.path === worktree.path,
        );
        return { ...worktree, sessions };
      }),
    [worktrees, sessionList],
  );

  function addWorktree() {
    fetcher.reset();
    void fetcher.submit({ type: "addWorktree", dir: cwd } satisfies ActionInput, {
      method: "post",
      encType: "application/json",
    });
  }

  function deleteSession(session: SessionListItem) {
    const title = session.firstMessage || "Untitled Session";
    if (!window.confirm(`Delete this session?\n\n"${title}"`)) return;
    fetcher.reset();
    void fetcher.submit(
      {
        type: "deleteSession",
        id: session.id,
        dir: session.cwd,
      } satisfies ActionInput,
      { method: "post", encType: "application/json" },
    );
  }

  /** True while a delete request for this session is in flight. */
  function isDeleting(sessionId: string): boolean {
    return (
      fetcher.state !== "idle" &&
      fetcher.formData?.get("type") === "deleteSession" &&
      fetcher.formData?.get("id") === sessionId
    );
  }

  function deleteWorktree(worktree: WorktreeWithSessions) {
    const branch = worktree.branch ?? worktree.head ?? "detached";
    const sessionCount = worktree.sessions.length;
    const message =
      sessionCount > 0
        ? `Delete this worktree?\n\nBranch "${branch}" has ${sessionCount} ${sessionCount === 1 ? "session" : "sessions"} stored for it, which will also be deleted.`
        : `Delete this worktree?\n\nBranch "${branch}"`;
    if (!window.confirm(message)) return;
    fetcher.reset();
    void fetcher.submit(
      {
        type: "deleteWorktree",
        dir: cwd,
        path: worktree.path,
      } satisfies ActionInput,
      { method: "post", encType: "application/json" },
    );
  }

  /** True while a delete request for this worktree is in flight. */
  function isDeletingWorktree(worktreePath: string): boolean {
    return (
      fetcher.state !== "idle" &&
      fetcher.formData?.get("type") === "deleteWorktree" &&
      fetcher.formData?.get("path") === worktreePath
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Layers className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-gray-900 dark:text-gray-100">Select Session</span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/settings"
              aria-label="Settings"
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
            >
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full px-2 py-6 sm:p-6">
        {!ready ? (
          <div className="flex justify-center py-10">
            <Loader2Icon className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-green-600 dark:text-green-500" />
                  Worktrees
                </h2>
                <button
                  onClick={addWorktree}
                  disabled={fetcher.state !== "idle"}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Worktree
                </button>
              </div>
              {(fetcher.formData?.get("type") === "addWorktree" ||
                fetcher.formData?.get("type") === "deleteWorktree") &&
                fetcher.data &&
                "error" in fetcher.data && (
                  <p className="text-sm text-red-600 dark:text-red-400 mb-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                    {fetcher.data.error}
                  </p>
                )}
              {fetcher.formData?.get("type") === "deleteSession" &&
                fetcher.data &&
                "error" in fetcher.data && (
                  <p className="text-sm text-red-600 dark:text-red-400 mb-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                    {fetcher.data.error}
                  </p>
                )}
              <div className="space-y-2">
                {worktreesWithSessions.map((worktree) => (
                  <WorktreeGroup
                    key={worktree.path}
                    worktree={worktree}
                    onDeleteSession={deleteSession}
                    onDeleteWorktree={deleteWorktree}
                    isDeletingSession={isDeleting}
                    isDeletingWorktree={isDeletingWorktree}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
