import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AgentSessionContainer } from "~/agent-session-container";
import { ProjectRepository } from "~/project-repository";
import {
  agentSessionContainerContext,
  projectRepositoryContext,
  worktreeRepositoryContext,
} from "~/router-contexts";
import { WorktreeRepository } from "~/worktree-repository";

import { action, loader } from "./route";

/** A runtime factory that is never invoked by the tested paths. */
const noopFactory: CreateAgentSessionRuntimeFactory = async () => {
  throw new Error("runtime factory should not be called");
};

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Async git runner delegating to the real git (for mocked repositories). */
function runGit(args: string[], options: { cwd?: string } = {}): Promise<string> {
  return Promise.resolve(execFileSync("git", args, { cwd: options.cwd, encoding: "utf8" }).trim());
}

function createRepo(): { root: string; project: string; dataDir: string; agentDir: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-route-"));
  const project = path.join(root, "project");
  const dataDir = path.join(root, "worktrees");
  const agentDir = path.join(root, "agent");
  mkdirSync(project, { recursive: true });
  git(project, ["init", "--quiet", "--initial-branch", "main"]);
  git(project, ["config", "user.email", "test@example.com"]);
  git(project, ["config", "user.name", "Test"]);
  writeFileSync(path.join(project, "file.txt"), "hello\n");
  git(project, ["add", "."]);
  git(project, ["commit", "--quiet", "--message", "init"]);
  return { root, project, dataDir, agentDir };
}

/**
 * Persist a session for `cwd` under the default agent dir (redirected to a
 * temp dir via PI_CODING_AGENT_DIR) and return its id and file path.
 * Session files are only written once an assistant message arrives, so append
 * a user message followed by an assistant reply.
 */
function createSession(cwd: string): { id: string; file: string } {
  const sm = SessionManager.create(cwd);
  const timestamp = Date.now();
  sm.appendMessage({ role: "user", content: "hello", timestamp });
  sm.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Hi there!" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  });
  return { id: sm.getSessionId(), file: sm.getSessionFile()! };
}

function postAction(context: RouterContextProvider, body: unknown): Promise<unknown> {
  return action({
    request: new Request("http://localhost/session?dir=test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    url: new URL("http://localhost/session?dir=test"),
    params: {},
    pattern: "/session",
    context,
  });
}

async function runLoader(
  context: RouterContextProvider,
  options: { dir?: string; id?: string } = {},
): Promise<unknown> {
  const query = options.dir ? `?dir=${encodeURIComponent(options.dir)}` : "";
  return loader({
    request: new Request(`http://localhost/session${query}`),
    url: new URL(`http://localhost/session${query}`),
    params: options.id ? { id: options.id } : {},
    pattern: "/session",
    context,
  });
}

/** Redirect the session storage dir so tests never touch the real ~/.pi/agent. */
function withAgentDir(agentDir: string, fn: () => Promise<void>): Promise<void> {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return fn().finally(() => {
    if (previous === undefined) {
      // Assignment would store the string "undefined"; delete to unset.
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  });
}

describe("session layout loader", () => {
  it("redirects home when no directory is given and no session is open", async () => {
    const error = (await runLoader(new RouterContextProvider()).catch(
      (e: unknown) => e,
    )) as Response;
    expect(error).toBeInstanceOf(Response);
    expect(error.status).toBe(302);
    expect(error.headers.get("Location")).toBe("/");
  });

  it("uses the ?dir parameter for the sidebar's project", async () => {
    const { root, project, dataDir, agentDir } = createRepo();
    try {
      await withAgentDir(agentDir, async () => {
        const repo = new WorktreeRepository({ dataDir });
        const worktree = await repo.add(project);
        const projects = new ProjectRepository({ inMemory: true });
        await projects.add(project);

        const context = new RouterContextProvider();
        context.set(worktreeRepositoryContext, repo);
        context.set(projectRepositoryContext, projects);
        context.set(agentSessionContainerContext, AgentSessionContainer.withFactory(noopFactory));

        const result = (await runLoader(context, { dir: project })) as {
          cwd: string;
          worktrees: { path: string; isMain: boolean; isManaged: boolean }[];
        };
        expect(result.cwd).toBe(path.resolve(project));
        expect(result.worktrees).toHaveLength(2);
        expect(result.worktrees[0]).toMatchObject({ path: path.resolve(project), isMain: true });
        expect(result.worktrees[1]).toMatchObject({ path: worktree.path, isManaged: true });
        // Registering recent projects is the index route's job, not the layout's:
        // a worktree's New Session link must not register the worktree as one.
        expect(projects.list().map((entry) => entry.path)).toEqual([project]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives the main worktree from a worktree session's cwd when no ?dir is given", async () => {
    const { root, project, dataDir, agentDir } = createRepo();
    try {
      await withAgentDir(agentDir, async () => {
        const repo = new WorktreeRepository({ dataDir });
        const worktree = await repo.add(project);
        // A session whose cwd is a linked worktree of the project, not the root.
        const { id } = createSession(worktree.path);

        const context = new RouterContextProvider();
        context.set(worktreeRepositoryContext, repo);
        context.set(projectRepositoryContext, new ProjectRepository({ inMemory: true }));
        context.set(agentSessionContainerContext, AgentSessionContainer.withFactory(noopFactory));

        const result = (await runLoader(context, { id })) as {
          cwd: string;
          worktrees: { path: string }[];
        };
        expect(result.cwd).toBe(path.resolve(project));
        expect(result.worktrees.map((entry) => entry.path)).toContain(worktree.path);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses a non-git session cwd as the sidebar project without registering it", async () => {
    const { root, dataDir, agentDir } = createRepo();
    try {
      await withAgentDir(agentDir, async () => {
        const plainDir = path.join(root, "plain");
        mkdirSync(plainDir, { recursive: true });
        const { id } = createSession(plainDir);

        const projects = new ProjectRepository({ inMemory: true });
        const context = new RouterContextProvider();
        context.set(worktreeRepositoryContext, new WorktreeRepository({ dataDir }));
        context.set(projectRepositoryContext, projects);
        context.set(agentSessionContainerContext, AgentSessionContainer.withFactory(noopFactory));

        const result = (await runLoader(context, { id })) as { cwd: string };
        expect(result.cwd).toBe(path.resolve(plainDir));
        // Viewing a session must not touch the recently-used projects list.
        expect(projects.list()).toEqual([]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("session list action", () => {
  it("deleteWorktree removes the worktree and deletes its sessions", async () => {
    const { root, project, dataDir, agentDir } = createRepo();
    try {
      await withAgentDir(agentDir, async () => {
        const repo = new WorktreeRepository({ dataDir });
        const worktree = await repo.add(project);
        const container = AgentSessionContainer.withFactory(noopFactory);

        // Sessions live outside the worktree directory (~/.pi/agent/sessions),
        // so they must be cleaned up explicitly.
        const { file } = createSession(worktree.path);
        expect(existsSync(file)).toBe(true);
        expect(await SessionManager.list(worktree.path)).toHaveLength(1);

        const context = new RouterContextProvider();
        context.set(worktreeRepositoryContext, repo);
        context.set(agentSessionContainerContext, container);

        const result = await postAction(context, {
          type: "deleteWorktree",
          dir: project,
          path: worktree.path,
        });
        expect(result).toEqual({ ok: true });

        expect(await repo.list(project)).toEqual([]);
        expect(existsSync(file)).toBe(false);
        expect(await SessionManager.list(worktree.path)).toEqual([]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deleteWorktree rejects a worktree the app does not manage", async () => {
    const { root, project, dataDir, agentDir } = createRepo();
    try {
      await withAgentDir(agentDir, async () => {
        const repo = new WorktreeRepository({ dataDir });
        // A linked worktree created outside the app data dir is listed but
        // must not be deletable through the action.
        const otherDir = path.join(root, "user-worktree");
        git(project, ["worktree", "add", "-b", "feature/user", otherDir, "HEAD"]);

        const context = new RouterContextProvider();
        context.set(worktreeRepositoryContext, repo);
        context.set(agentSessionContainerContext, AgentSessionContainer.withFactory(noopFactory));

        const result = await postAction(context, {
          type: "deleteWorktree",
          dir: project,
          path: otherDir,
        });
        // Error paths return react-router's DataWithResponseInit.
        const response = result as { type: string; data: { error?: string } };
        expect(response.type).toBe("DataWithResponseInit");
        expect(response.data.error).toMatch(/app-managed/);

        // The worktree and its branch are untouched.
        expect(existsSync(otherDir)).toBe(true);
        expect(() =>
          git(project, ["rev-parse", "--verify", "refs/heads/feature/user"]),
        ).not.toThrow();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deleteWorktree preserves sessions when worktree removal fails", async () => {
    const { root, project, dataDir, agentDir } = createRepo();
    try {
      await withAgentDir(agentDir, async () => {
        // Simulate a removal failure (e.g. locked files on Windows): the
        // worktree is removed from git only after its sessions are deleted,
        // so a failure must not destroy the chat history.
        const repo = new WorktreeRepository({
          dataDir,
          runGit: async (args, options = {}) => {
            if (args[0] === "worktree" && args[1] === "remove") {
              throw new Error("fatal: failed to remove worktree (locked)");
            }
            return runGit(args, options);
          },
        });
        const worktree = await repo.add(project);
        const { file } = createSession(worktree.path);
        expect(existsSync(file)).toBe(true);

        const context = new RouterContextProvider();
        context.set(worktreeRepositoryContext, repo);
        context.set(agentSessionContainerContext, AgentSessionContainer.withFactory(noopFactory));

        const result = await postAction(context, {
          type: "deleteWorktree",
          dir: project,
          path: worktree.path,
        });
        const response = result as { type: string; data: { error?: string } };
        expect(response.type).toBe("DataWithResponseInit");
        expect(response.data.error).toMatch(/failed to remove worktree/);

        // The failed removal must leave both the worktree and its sessions.
        expect(await repo.list(project)).toHaveLength(1);
        expect(existsSync(file)).toBe(true);
        expect(await SessionManager.list(worktree.path)).toHaveLength(1);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
