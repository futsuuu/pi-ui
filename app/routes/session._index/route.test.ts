import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { ProjectRepository } from "~/project-repository";
import { projectRepositoryContext, worktreeRepositoryContext } from "~/router-contexts";
import { WorktreeRepository } from "~/worktree-repository";

import { loader } from "./route";

const MAIN = "/repo/main";
const LINKED = "/repo/linked";

/** `git worktree list --porcelain` shaped output for the given worktrees. */
function porcelain(...paths: string[]): string {
  return paths.map((path_) => `worktree ${path_}\nHEAD abc1234\ndetached\n`).join("\n\n");
}

/** WorktreeRepository whose git calls are stubbed to `porcelain`. */
function repository(porcelainOutput: string): WorktreeRepository {
  return new WorktreeRepository({
    dataDir: "/tmp/test-worktrees",
    runGit: async (args) => {
      if (args[0] === "worktree" && args[1] === "list") return porcelainOutput;
      if (args[0] === "worktree" && args[1] === "prune") return "";
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return MAIN;
      return "";
    },
  });
}

function runLoader(context: RouterContextProvider, dir?: string): Promise<unknown> {
  const query = dir ? `?dir=${encodeURIComponent(dir)}` : "";
  return loader({
    request: new Request(`http://localhost/session${query}`),
    url: new URL(`http://localhost/session${query}`),
    params: {},
    pattern: "/session",
    context,
  });
}

describe("session index loader", () => {
  it("registers the browsed directory as a recently used project", async () => {
    const projects = new ProjectRepository({ inMemory: true });
    const context = new RouterContextProvider();
    context.set(projectRepositoryContext, projects);
    context.set(worktreeRepositoryContext, repository(porcelain(MAIN, LINKED)));

    await runLoader(context, MAIN);

    expect(projects.list().map((project) => project.path)).toEqual([MAIN]);
  });

  it("redirects a linked worktree to the main worktree without registering it", async () => {
    const projects = new ProjectRepository({ inMemory: true });
    const context = new RouterContextProvider();
    context.set(projectRepositoryContext, projects);
    context.set(worktreeRepositoryContext, repository(porcelain(MAIN, LINKED)));

    const error = (await runLoader(context, LINKED).catch((e: unknown) => e)) as Response;

    expect(error).toBeInstanceOf(Response);
    expect(error.status).toBe(302);
    expect(error.headers.get("Location")).toBe(`/session?dir=${encodeURIComponent(MAIN)}`);
    expect(projects.list()).toEqual([]);
  });

  it("keeps a main worktree subdirectory as its own project", async () => {
    const SUB = `${MAIN}/sub`;
    const projects = new ProjectRepository({ inMemory: true });
    const context = new RouterContextProvider();
    context.set(projectRepositoryContext, projects);
    context.set(worktreeRepositoryContext, repository(porcelain(MAIN, LINKED)));

    await runLoader(context, SUB);

    expect(projects.list().map((project) => project.path)).toEqual([SUB]);
  });

  it("registers nothing without a ?dir parameter", async () => {
    const projects = new ProjectRepository({ inMemory: true });
    const context = new RouterContextProvider();
    context.set(projectRepositoryContext, projects);
    context.set(worktreeRepositoryContext, repository(porcelain(MAIN, LINKED)));

    await expect(runLoader(context)).resolves.toBeNull();
    expect(projects.list()).toEqual([]);
  });
});
