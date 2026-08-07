import path from "node:path";

import {
  Clock,
  GitBranch,
  Layers,
  MessageCirclePlus,
  Moon,
  MoreVertical,
  Plus,
  Sun,
} from "lucide-react";
import { data, Link, redirect, useFetcher, useLoaderData } from "react-router";
import * as v from "valibot";

import { ActionsMenu, DeleteMenuItem } from "~/components/actions-menu";
import { useTheme } from "~/contexts/theme";
import {
  agentSessionContainerContext,
  projectRepositoryContext,
  worktreeRepositoryContext,
} from "~/router-contexts";
import type { Worktree } from "~/worktree-repository";

import type { Route } from "./+types/route";

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
  const sessionContainer = context.get(agentSessionContainerContext);
  const worktreeRepository = context.get(worktreeRepositoryContext);

  let worktrees: Worktree[] = [];
  try {
    worktrees = await worktreeRepository.list(dir);
  } catch {
    worktrees = [];
  }

  const rootSessions = await sessionContainer.listInfo(dir);
  const worktreeEntries = await Promise.all(
    worktrees.map(async (worktree) => ({
      worktree,
      sessions: await sessionContainer.listInfo(worktree.path),
    })),
  );

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

  const sessions = [
    ...rootSessions.map((session) => ({ ...session, worktree: null })),
    ...worktreeEntries.flatMap(({ worktree, sessions }) =>
      sessions.map((session) => ({ ...session, worktree })),
    ),
  ].sort((a, b) => b.timestamp - a.timestamp);

  return {
    sessions,
    worktrees: [
      {
        branch: mainBranch ?? path.basename(dir),
        head: null,
        path: dir,
        isMain: true,
        isManaged: false,
        sessionCount: rootSessions.length,
      },
      ...worktrees.map((worktree) => ({
        ...worktree,
        isMain: false,
        isManaged: managedPaths.has(worktree.path),
        sessionCount:
          worktreeEntries.find((entry) => entry.worktree.path === worktree.path)?.sessions.length ??
          0,
      })),
    ],
    cwd: dir,
  };
}

export default function Sessions() {
  const { theme, toggleTheme } = useTheme();
  const { sessions, worktrees, cwd } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

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

  const newSessionHref = `/session/new?dir=${encodeURIComponent(cwd)}`;

  function addWorktree() {
    fetcher.reset();
    void fetcher.submit({ type: "addWorktree", dir: cwd } satisfies ActionInput, {
      method: "post",
      encType: "application/json",
    });
  }

  function deleteSession(session: (typeof sessions)[number]) {
    const title = session.firstMessage || "Untitled Session";
    if (!window.confirm(`Delete this session?\n\n"${title}"`)) return;
    fetcher.reset();
    void fetcher.submit(
      {
        type: "deleteSession",
        id: session.id,
        dir: session.worktree?.path ?? cwd,
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

  function deleteWorktree(worktree: (typeof worktrees)[number]) {
    const branch = worktree.branch ?? worktree.head ?? "detached";
    const { sessionCount } = worktree;
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
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full p-6">
        {/* Worktrees */}
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
          <div className="space-y-2">
            {worktrees.map((worktree) => (
              <div
                key={worktree.path}
                className={`flex items-center justify-between gap-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3${isDeletingWorktree(worktree.path) ? " opacity-50 pointer-events-none" : ""}`}
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
                    {worktree.branch ?? worktree.head ?? "detached"}
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
                    {worktree.sessionCount} {worktree.sessionCount === 1 ? "session" : "sessions"}
                  </p>
                </div>
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
                    triggerClassName="p-2 -m-1"
                  >
                    <DeleteMenuItem
                      onSelect={() => deleteWorktree(worktree)}
                      label="Delete Worktree"
                      disabled={worktree.isMain || !worktree.isManaged}
                    />
                  </ActionsMenu>
                </div>
              </div>
            ))}
          </div>
          {worktrees.length === 1 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-1 mt-2">
              No extra worktrees yet. Add one to work on a separate branch without touching the main
              working tree.
            </p>
          )}
        </div>

        {/* Sessions */}
        {sessions.length === 0 ? (
          <div className="text-center py-16">
            <Clock
              className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600"
              strokeWidth={1.5}
            />
            <p className="text-gray-500 dark:text-gray-400 mb-2">No previous sessions</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
              Start a new chat session to begin working with Pi
            </p>
            <Link
              to={newSessionHref}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Start Chatting
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {fetcher.formData?.get("type") === "deleteSession" &&
              fetcher.data &&
              "error" in fetcher.data && (
                <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  {fetcher.data.error}
                </p>
              )}
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`relative ${isDeleting(session.id) ? "opacity-50 pointer-events-none" : ""}`}
              >
                <Link
                  to={`/session/${encodeURIComponent(session.id)}`}
                  className="block w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate pr-12">
                        {session.firstMessage || "Untitled Session"}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1.5 flex-wrap">
                        {formatDate(session.timestamp)} · {session.messageCount} messages
                        {session.worktree && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 font-mono">
                            <GitBranch className="w-3 h-3" />
                            {session.worktree.branch ?? session.worktree.head ?? "detached"}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </Link>
                <ActionsMenu
                  ariaLabel="Session actions"
                  trigger={<MoreVertical className="w-5 h-5" />}
                  triggerClassName="absolute top-1/2 -translate-y-1/2 right-3 p-1.5"
                >
                  <DeleteMenuItem onSelect={() => deleteSession(session)} label="Delete Session" />
                </ActionsMenu>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
