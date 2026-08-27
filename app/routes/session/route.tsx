import path from "node:path";

import {
  ChevronRight,
  Dot,
  GitBranch,
  Loader2Icon,
  Menu,
  MessageCirclePlus,
  MoreVertical,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { Collapsible } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import {
  data,
  Link,
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams,
} from "react-router";
import { cva, css, cx } from "styled-system/css";
import { card, iconButton } from "styled-system/recipes";
import * as v from "valibot";

import { ActionsMenu, DeleteMenuItem } from "~/components/actions-menu";
import { ScrollArea } from "~/components/scroll-area";
import { useSessionEventsContext } from "~/contexts/session-events";
import { agentSessionContainerContext, worktreeRepositoryContext } from "~/router-contexts";
import type { Worktree } from "~/worktree-repository";

import type { Route } from "./+types/route";
import { useSessionList, type SessionListItem } from "./session-list";

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

/**
 * The sidebar's project root for a session: the repository's main worktree
 * when the session's cwd sits inside a git repository, the cwd itself
 * otherwise. `null` when no session with this ID exists.
 */
function projectOfSession(
  context: Route.LoaderArgs["context"],
  sessionId: string,
): Promise<string | null> {
  const container = context.get(agentSessionContainerContext);
  const worktreeRepository = context.get(worktreeRepositoryContext);
  return container.findSessionCwd(sessionId).then((cwd) => cwd && worktreeRepository.mainPath(cwd));
}

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
      const canonicalPath = worktreeRepository.canonicalize(worktreePath);
      const worktrees = await worktreeRepository.list(dir);
      const worktree = worktrees.find((entry) => entry.path === canonicalPath);
      if (!worktree) {
        return data({ error: "Worktree not found" }, { status: 400 });
      }
      if (path.resolve(canonicalPath) === path.resolve(await worktreeRepository.mainPath(dir))) {
        return data({ error: "Cannot delete the main worktree" }, { status: 400 });
      }
      if (!(await worktreeRepository.isManagedWorktreePath(dir, worktree.path))) {
        return data({ error: "Only app-managed worktrees can be deleted" }, { status: 400 });
      }
      // Sessions live outside the working tree: remove the worktree first so a
      // failed removal leaves both the worktree and its history intact.
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

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  let dir = url.searchParams.get("dir");
  if (!dir && params.id) {
    // A session URL carries no project; derive it from the session itself.
    // Only the index route registers projects: viewing a session must not
    // touch the recently-used projects list.
    dir = await projectOfSession(context, params.id);
  }
  if (!dir) {
    throw redirect("/");
  }
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
  if (diff < 30 * 86400000) return `${Math.floor(diff / (30 * 86400000))}mo ago`;
  return d.toLocaleDateString();
}

function isAttentionSession(session: SessionListItem): boolean {
  return session.isStreaming || !session.isRead;
}

const triggerPadding = css({ padding: "1.5" });

const viewportStyle = css({ paddingInline: "3", paddingBottom: "4" });

const sessionRow = cva({
  base: {
    display: "flex",
    alignItems: "center",
    borderRadius: "lg",
    transitionProperty: "colors",
    transitionDuration: "150ms",
  },
  variants: {
    open: {
      true: {
        backgroundColor: "wash.accent",
        color: "accent.fg",
        _hover: { backgroundColor: "wash.accent" },
      },
      false: {
        _hover: { backgroundColor: "wash.primary" },
      },
    },
    deleting: {
      true: { opacity: 0.5, pointerEvents: "none" },
      false: {},
    },
  },
});

const badgeBase = css.raw({
  paddingInline: "1.5",
  paddingBlock: "0.5",
  borderRadius: "full",
  fontSize: "10px",
  fontFamily: "sans",
  fontWeight: "medium",
  textTransform: "uppercase",
  letterSpacing: "0.025em",
  flexShrink: 0,
});

const mainBadgeStyle = cx(
  css(badgeBase),
  css({ backgroundColor: "wash.accent", color: "accent.fg" }),
);

const detachedBadgeStyle = cx(
  css(badgeBase),
  css({ backgroundColor: "bg.subtle", color: "fg.muted" }),
);

const newSessionLinkStyle = cx(iconButton({ emphasis: "onHover" }), css({ margin: "-1" }));

const sectionStyle = css({
  borderTopWidth: "1px",
  borderColor: "border.divider",
  paddingBlock: "1",
  paddingInline: "1",
});

const worktreeCardStyle = cx(
  card(),
  css({
    overflow: "hidden",
  }),
);

const overlayStyle = css({
  position: "fixed",
  inset: 0,
  zIndex: 30,
  backgroundColor: "bg.overlay",
  lg: { display: "none" },
  transitionProperty: "opacity",
  transitionDuration: "200ms",
});

const sidebarToggleStyle = cx(
  iconButton(),
  css({
    position: "fixed",
    left: "2",
    top: "2.5",
    zIndex: 50,
    lg: { display: "none" },
  }),
);

const sidebarStyle = css({
  position: "fixed",
  insetBlock: 0,
  left: 0,
  zIndex: 40,
  display: "flex",
  height: "full",
  width: "full",
  flexDirection: "column",
  backgroundColor: "bg.page",
  transitionProperty: "transform",
  transitionDuration: "200ms",
  sm: { width: "24rem" },
  lg: {
    position: "static",
    width: "24rem",
    flexShrink: 0,
    transform: "translateX(0)",
    visibility: "visible",
    pointerEvents: "auto",
    borderRightWidth: "1px",
    borderColor: "border.panel",
  },
});

const ghostIconButton = iconButton();

const addWorktreeButton = css({
  paddingInline: "3",
  paddingBlock: "1.5",
  borderRadius: "lg",
  textStyle: "sm",
  fontWeight: "medium",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  display: "flex",
  alignItems: "center",
  gap: "1.5",
  backgroundColor: "bg.subtle",
  _hover: { backgroundColor: "wash.secondary" },
  color: "fg.secondary",
  _disabled: { opacity: 0.5, cursor: "not-allowed" },
});

const errorBannerStyle = css({
  textStyle: "sm",
  color: "danger",
  marginBottom: "2",
  backgroundColor: "wash.danger",
  borderWidth: "1px",
  borderColor: "danger.border",
  borderRadius: "lg",
  paddingInline: "3",
  paddingBlock: "2",
});

function SessionRow({
  session,
  deleting,
  open,
  onDelete,
}: {
  session: SessionListItem;
  deleting: boolean;
  open: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      className={cx(
        sessionRow({ open, deleting }),
        css({
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }),
      )}
    >
      <span
        className={css({
          width: "6",
          height: "4",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        })}
      >
        {session.isStreaming ? (
          <Loader2Icon
            aria-label="Streaming"
            className={css({ width: "4", height: "4", color: "info", animation: "spin" })}
          />
        ) : (
          !session.isRead && (
            <Dot
              aria-label="Unread"
              className={css({ width: "4", height: "4", fill: "current", color: "info" })}
            />
          )
        )}
      </span>
      <Link
        to={`/session/${encodeURIComponent(session.id)}`}
        className={css({ minWidth: 0, flex: "1", paddingBlock: "2", textAlign: "left" })}
      >
        <p
          className={css({
            fontWeight: "medium",
            textStyle: "sm",
            color: open ? "accent.fg" : "fg.primary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          })}
        >
          {session.firstMessage || "Untitled Session"}
        </p>
        <p
          className={css({
            textStyle: "xs",
            color: "fg.muted",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          })}
        >
          {formatDate(session.timestamp)} · {session.messageCount} messages
        </p>
      </Link>
      <ActionsMenu
        ariaLabel="Session actions"
        trigger={<MoreVertical className={css({ width: "5", height: "5" })} />}
        triggerClassName={triggerPadding}
      >
        <DeleteMenuItem onSelect={onDelete} label="Delete Session" />
      </ActionsMenu>
    </div>
  );
}

function WorktreeGroup({
  worktree,
  openSessionId,
  onDeleteSession,
  onDeleteWorktree,
  isDeletingSession,
  isDeletingWorktree,
}: {
  worktree: WorktreeWithSessions;
  openSessionId: string | undefined;
  onDeleteSession: (session: SessionListItem) => void;
  onDeleteWorktree: (worktree: WorktreeWithSessions) => void;
  isDeletingSession: (sessionId: string) => boolean;
  isDeletingWorktree: (worktreePath: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const attentionSessions = worktree.sessions.filter(
    (session) =>
      isAttentionSession(session) || (openSessionId !== undefined && session.id === openSessionId),
  );
  const branch = worktree.branch ?? worktree.head ?? "detached";
  const renderSession = (session: SessionListItem) => (
    <SessionRow
      key={session.id}
      session={session}
      deleting={isDeletingSession(session.id)}
      open={session.id === openSessionId}
      onDelete={() => onDeleteSession(session)}
    />
  );

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={cx(
        worktreeCardStyle,
        isDeletingWorktree(worktree.path) && css({ opacity: 0.5, pointerEvents: "none" }),
      )}
    >
      <div className={css({ padding: "1" })}>
        <div
          className={css({
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "2",
            borderRadius: "lg",
            paddingBlock: "2",
            _hover: { backgroundColor: "wash.primary" },
          })}
        >
          <Collapsible.Trigger asChild>
            <button
              type="button"
              className={css({
                display: "flex",
                minWidth: 0,
                flex: "1",
                alignItems: "center",
                gap: "1",
                paddingInlineStart: "1",
                textAlign: "left",
              })}
            >
              <ChevronRight
                className={css({
                  width: "4",
                  height: "4",
                  flexShrink: 0,
                  color: "fg.subtle",
                  transitionProperty: "transform",
                  transitionDuration: "150ms",
                  transform: open ? "rotate(90deg)" : undefined,
                })}
              />
              <div className={css({ minWidth: 0 })}>
                <p
                  className={`font-mono ${css({
                    textStyle: "sm",
                    color: "fg.primary",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: "2",
                  })}`}
                >
                  {branch}
                  {worktree.isMain && <span className={mainBadgeStyle}>main</span>}
                  {worktree.branch === null && <span className={detachedBadgeStyle}>detached</span>}
                </p>
                <p className={css({ textStyle: "xs", color: "fg.muted" })}>
                  {worktree.sessions.length}{" "}
                  {worktree.sessions.length === 1 ? "session" : "sessions"}
                </p>
              </div>
            </button>
          </Collapsible.Trigger>
          <div className={css({ display: "flex", alignItems: "center", gap: "1", flexShrink: 0 })}>
            <Link
              to={`/session/new?dir=${encodeURIComponent(worktree.path)}`}
              title="New Session"
              className={newSessionLinkStyle}
            >
              <MessageCirclePlus className={css({ width: "5", height: "5" })} />
            </Link>
            <ActionsMenu
              ariaLabel="Worktree actions"
              trigger={<MoreVertical className={css({ width: "5", height: "5" })} />}
              triggerClassName={triggerPadding}
            >
              <DeleteMenuItem
                onSelect={() => onDeleteWorktree(worktree)}
                label="Delete Worktree"
                disabled={worktree.isMain || !worktree.isManaged}
              />
            </ActionsMenu>
          </div>
        </div>
      </div>
      {worktree.sessions.length > 0 && (
        <Collapsible.Content>
          <div className={sectionStyle}>{worktree.sessions.map(renderSession)}</div>
        </Collapsible.Content>
      )}
      {!open && attentionSessions.length > 0 && (
        <div className={sectionStyle}>{attentionSessions.map(renderSession)}</div>
      )}
    </Collapsible.Root>
  );
}

/**
 * Layout for `/session` routes: the session list sidebar plus the selected
 * route's content. Wide viewports show the sidebar persistently; narrower
 * ones toggle it over the content through a hamburger button (full-screen on
 * mobile).
 */
export default function SessionLayout() {
  const { worktrees, cwd } = useLoaderData<typeof loader>();
  const { ready } = useSessionEventsContext();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const { id: openSessionId } = useParams();
  const [sidebarOpen, setSidebarOpen] = useState(openSessionId === undefined);
  const [prevSessionId, setPrevSessionId] = useState(openSessionId);
  if (openSessionId !== prevSessionId) {
    setPrevSessionId(openSessionId);
    setSidebarOpen(openSessionId === undefined);
  }

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
      action: "/session",
    });
  }

  function deleteSession(session: SessionListItem) {
    const title = session.firstMessage || "Untitled Session";
    if (!window.confirm(`Delete this session?\n\n"${title}"`)) return;
    if (openSessionId === session.id) void navigate(`/session?dir=${encodeURIComponent(cwd)}`);
    fetcher.reset();
    void fetcher.submit(
      {
        type: "deleteSession",
        id: session.id,
        dir: session.cwd,
      } satisfies ActionInput,
      { method: "post", encType: "application/json", action: "/session" },
    );
  }

  function isDeleting(sessionId: string): boolean {
    const input = fetcher.state !== "idle" ? (fetcher.json as ActionInput | undefined) : undefined;
    return input?.type === "deleteSession" && input.id === sessionId;
  }

  function deleteWorktree(worktree: WorktreeWithSessions) {
    const branch = worktree.branch ?? worktree.head ?? "detached";
    const sessionCount = worktree.sessions.length;
    const message =
      sessionCount > 0
        ? `Delete this worktree?\n\nBranch "${branch}" has ${sessionCount} ${sessionCount === 1 ? "session" : "sessions"} stored for it, which will also be deleted.`
        : `Delete this worktree?\n\nBranch "${branch}"`;
    if (!window.confirm(message)) return;
    // The open session lives in this worktree; leave the chat before destroying it.
    if (
      openSessionId !== undefined &&
      worktree.sessions.some((session) => session.id === openSessionId)
    )
      void navigate(`/session?dir=${encodeURIComponent(cwd)}`);
    fetcher.reset();
    void fetcher.submit(
      {
        type: "deleteWorktree",
        dir: cwd,
        path: worktree.path,
      } satisfies ActionInput,
      { method: "post", encType: "application/json", action: "/session" },
    );
  }

  function isDeletingWorktree(worktreePath: string): boolean {
    const input = fetcher.state !== "idle" ? (fetcher.json as ActionInput | undefined) : undefined;
    return input?.type === "deleteWorktree" && input.path === worktreePath;
  }

  return (
    <div className={css({ height: "full", display: "flex" })}>
      <div
        className={cx(
          overlayStyle,
          sidebarOpen ? css({ opacity: 1 }) : css({ opacity: 0, pointerEvents: "none" }),
        )}
        onClick={() => setSidebarOpen(false)}
      />

      <button
        type="button"
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className={sidebarToggleStyle}
      >
        {sidebarOpen ? (
          <X className={css({ width: "5", height: "5" })} />
        ) : (
          <Menu className={css({ width: "5", height: "5" })} />
        )}
      </button>

      <aside
        className={cx(
          sidebarStyle,
          sidebarOpen
            ? css({ transform: "translateX(0)", visibility: "visible" })
            : css({
                transform: "translateX(-100%)",
                visibility: "hidden",
                pointerEvents: "none",
              }),
        )}
      >
        <div
          className={css({
            flexShrink: 0,
            height: "14",
            paddingInline: "3",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          })}
        >
          <Link to="/settings" aria-label="Settings" className={ghostIconButton}>
            <Settings className={css({ width: "5", height: "5" })} />
          </Link>
        </div>

        <ScrollArea disableHorizontalScroll viewportClassName={viewportStyle}>
          {!ready ? (
            <div className={css({ display: "flex", justifyContent: "center", paddingBlock: "10" })}>
              <Loader2Icon
                className={css({ width: "6", height: "6", color: "fg.subtle", animation: "spin" })}
              />
            </div>
          ) : (
            <>
              <div
                className={css({
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "2",
                  paddingInlineStart: "1",
                })}
              >
                <h2
                  className={css({
                    textStyle: "sm",
                    fontWeight: "medium",
                    color: "fg.secondary",
                    display: "flex",
                    alignItems: "center",
                    gap: "2",
                  })}
                >
                  <GitBranch
                    className={css({
                      width: "4",
                      height: "4",
                      color: "success.DEFAULT",
                    })}
                  />
                  Worktrees
                </h2>
                <button
                  onClick={addWorktree}
                  disabled={fetcher.state !== "idle"}
                  className={addWorktreeButton}
                >
                  <Plus className={css({ width: "3.5", height: "3.5" })} />
                  Add Worktree
                </button>
              </div>
              {fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data && (
                <p className={errorBannerStyle}>{fetcher.data.error}</p>
              )}
              <div
                className={css({
                  "& > :not([hidden]) ~ :not([hidden])": { marginTop: "2" },
                })}
              >
                {worktreesWithSessions.map((worktree) => (
                  <WorktreeGroup
                    key={worktree.path}
                    worktree={worktree}
                    openSessionId={openSessionId}
                    onDeleteSession={deleteSession}
                    onDeleteWorktree={deleteWorktree}
                    isDeletingSession={isDeleting}
                    isDeletingWorktree={isDeletingWorktree}
                  />
                ))}
              </div>
            </>
          )}
        </ScrollArea>
      </aside>

      <main className={css({ flex: "1", minWidth: 0, height: "full", overflow: "hidden" })}>
        <Outlet />
      </main>
    </div>
  );
}
