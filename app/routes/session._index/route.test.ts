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
import { agentSessionContainerContext, worktreeRepositoryContext } from "~/router-contexts";
import { WorktreeRepository } from "~/worktree-repository";

import { action } from "./route";

/** A runtime factory that is never invoked by the tested paths. */
const noopFactory: CreateAgentSessionRuntimeFactory = async () => {
  throw new Error("runtime factory should not be called");
};

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
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
});
