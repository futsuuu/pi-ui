import { describe, expect, it } from "vitest";

import type { SessionInfo } from "~/session-info";
import type { Worktree } from "~/worktree-repository";

import { buildSessionRows } from "./session-list";

function info(id: string, cwd: string, timestamp: number): SessionInfo {
  return {
    id,
    cwd,
    name: null,
    firstMessage: `first message of ${id}`,
    messageCount: 2,
    timestamp,
    model: null,
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
  };
}

const worktrees: Worktree[] = [
  { branch: "feature/x", head: null, path: "/repo/wt-feature" },
  { branch: null, head: "abc1234", path: "/repo/wt-detached" },
];

describe("buildSessionRows", () => {
  it("keeps only sessions of the project (root + worktrees)", () => {
    const sessions = new Map([
      ["root", info("root", "/repo", 100)],
      ["wt", info("wt", "/repo/wt-feature", 200)],
      ["other", info("other", "/elsewhere", 300)],
    ]);
    const rows = buildSessionRows(sessions, worktrees, "/repo");
    expect(rows.map((row) => row.id).sort()).toEqual(["root", "wt"]);
  });

  it("attaches the worktree by cwd and null for root sessions", () => {
    const sessions = new Map([
      ["root", info("root", "/repo", 100)],
      ["wt", info("wt", "/repo/wt-feature", 200)],
    ]);
    const rows = buildSessionRows(sessions, worktrees, "/repo");
    expect(rows.find((row) => row.id === "root")?.worktree).toBeNull();
    expect(rows.find((row) => row.id === "wt")?.worktree).toEqual(worktrees[0]);
  });

  it("sorts by timestamp descending", () => {
    const sessions = new Map([
      ["old", info("old", "/repo", 100)],
      ["new", info("new", "/repo", 300)],
      ["mid", info("mid", "/repo", 200)],
    ]);
    expect(buildSessionRows(sessions, worktrees, "/repo").map((row) => row.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("drops sessions whose cwd is a worktree deleted elsewhere", () => {
    const sessions = new Map([["gone", info("gone", "/repo/wt-removed", 100)]]);
    expect(buildSessionRows(sessions, worktrees, "/repo")).toEqual([]);
  });
});
