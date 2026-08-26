import { execFile, execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  generateBranchName,
  hashProjectPath,
  makeWritable,
  WorktreeRepository,
} from "./worktree-repository";

const execFileAsync = promisify(execFile);

// Spawning real git processes is slow on Windows CI runners; the default 5s
// per-test timeout is too tight there.
vi.setConfig({ testTimeout: 30_000 });

async function runGit(args: string[], options: { cwd?: string } = {}): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: options.cwd, encoding: "utf8" });
  return stdout;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function createRepo(): { root: string; project: string; dataDir: string } {
  // Resolve the canonical (long-name) form of the temp dir: on Windows the
  // runner's TMP uses 8.3 short names (RUNNER~1), while git reports the
  // long form. The repository canonicalizes all paths, so the expected
  // values must use the same canonical form.
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "pi-ui-worktree-")));
  const project = path.join(root, "project");
  const dataDir = path.join(root, "worktrees");
  mkdirSync(project, { recursive: true });
  git(project, ["init", "--quiet", "--initial-branch", "main"]);
  git(project, ["config", "user.email", "test@example.com"]);
  git(project, ["config", "user.name", "Test"]);
  writeFileSync(path.join(project, "file.txt"), "hello\n");
  git(project, ["add", "."]);
  git(project, ["commit", "--quiet", "--message", "init"]);
  return { root, project, dataDir };
}

describe("generateBranchName", () => {
  it("generates pi/<adjective>-<noun> branch names", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateBranchName()).toMatch(/^pi\/[a-z]+-[a-z]+$/);
    }
  });
});

describe("hashProjectPath", () => {
  it("produces a stable 12-char hex hash for the resolved path", () => {
    const project = "/tmp/example/project";
    const hash = hashProjectPath(project);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hashProjectPath(project)).toBe(hash);
  });
});

describe("makeWritable", () => {
  it("does not follow a symbolic-link root", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-writable-"));
    const outside = mkdtempSync(path.join(os.tmpdir(), "pi-ui-outside-"));
    try {
      const outsideFile = path.join(outside, "outside.txt");
      writeFileSync(outsideFile, "outside\n");
      chmodSync(outside, 0o555);
      chmodSync(outsideFile, 0o444);
      const link = path.join(root, "link");
      try {
        symlinkSync(outside, link);
      } catch {
        return;
      }
      await makeWritable(link);
      expect(statSync(outside).mode & 0o200).toBe(0);
      expect(statSync(outsideFile).mode & 0o200).toBe(0);
    } finally {
      chmodSync(outside, 0o755);
      chmodSync(path.join(outside, "outside.txt"), 0o644);
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("adds the owner-write bit recursively without following symlinks", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-writable-"));
    const outside = mkdtempSync(path.join(os.tmpdir(), "pi-ui-outside-"));
    try {
      const dir = path.join(root, "sub", "nested");
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "file.txt");
      writeFileSync(file, "hello\n");
      chmodSync(dir, 0o555);
      chmodSync(file, 0o444);
      const outsideFile = path.join(outside, "outside.txt");
      writeFileSync(outsideFile, "outside\n");
      chmodSync(outsideFile, 0o444);
      let linkCreated = false;
      try {
        symlinkSync(outside, path.join(root, "link"));
        linkCreated = true;
      } catch {
        // Symlinks may be unavailable (e.g. unprivileged Windows CI).
      }
      await makeWritable(root);
      expect(statSync(dir).mode & 0o200).toBe(0o200);
      expect(statSync(file).mode & 0o200).toBe(0o200);
      // The symlink is not followed: the file outside the tree stays read-only.
      if (linkCreated) {
        expect(statSync(outsideFile).mode & 0o200).toBe(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("WorktreeRepository", () => {
  it("adds a worktree with a random pi/ branch under the project's hash dir", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      const worktree = await repo.add(project);
      expect(worktree.branch).toMatch(/^pi\/[a-z]+-[a-z]+$/);
      expect(worktree.path).toBe(
        path.join(dataDir, hashProjectPath(project), worktree.branch!.replace(/^pi\//, "")),
      );
      const listed = await repo.list(project);
      expect(listed).toEqual([worktree]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists all linked worktrees except the main worktree", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      const appWorktree = await repo.add(project);
      // A worktree created outside the app data dir is listed as well.
      const otherDir = path.join(root, "other-wt");
      git(project, ["worktree", "add", "-b", "feature/other", otherDir, "HEAD"]);
      const sortByBranch = (a: { branch: string | null }, b: { branch: string | null }) =>
        (a.branch ?? "").localeCompare(b.branch ?? "");
      expect(await repo.list(project)).toEqual(
        [appWorktree, { branch: "feature/other", head: null, path: otherDir }].sort(sortByBranch),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not include worktrees of other projects", async () => {
    const { root, project, dataDir } = createRepo();
    const second = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      const appWorktree = await repo.add(project);
      await repo.add(second.project);
      const listed = await repo.list(project);
      expect(listed).toEqual([appWorktree]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(second.root, { recursive: true, force: true });
    }
  });

  it("excludes the main worktree when listing from a subdirectory", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      const appWorktree = await repo.add(project);
      const subdir = path.join(project, "subdir");
      mkdirSync(subdir, { recursive: true });
      expect(await repo.list(subdir)).toEqual([appWorktree]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists linked worktrees in detached HEAD with the short head sha", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      const detachedDir = path.join(root, "detached-wt");
      git(project, ["worktree", "add", "--detach", detachedDir, "HEAD"]);
      const listed = await repo.list(project);
      expect(listed).toHaveLength(1);
      expect(listed[0].branch).toBeNull();
      expect(listed[0].head).toMatch(/^[0-9a-f]{7}$/);
      expect(listed[0].path).toBe(detachedDir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries with a new branch name when the branch already exists", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      let addCalls = 0;
      const repo = new WorktreeRepository({
        dataDir,
        runGit: async (args, options) => {
          if (args[0] === "worktree" && args[1] === "add") {
            addCalls++;
            if (addCalls === 1) {
              throw new Error("fatal: a branch named 'pi/x' already exists");
            }
          }
          return runGit(args, options);
        },
      });
      const worktree = await repo.add(project);
      expect(addCalls).toBe(2);
      expect(await repo.list(project)).toEqual([worktree]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("canonicalize resolves non-canonical spellings of the same path", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      const worktree = await repo.add(project);
      // Dot segments and trailing separators are normalized away, the same
      // way 8.3 short names / case differences are on Windows.
      expect(repo.canonicalize(worktree.path + path.sep + ".")).toBe(worktree.path);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isManagedWorktreePath compares paths in canonical form", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      const worktree = await repo.add(project);
      // A non-canonical spelling of the app-created worktree (dot segment)
      // is still recognized as managed after canonicalization.
      const variant = worktree.path + path.sep + ".";
      expect(await repo.isManagedWorktreePath(project, variant)).toBe(true);
      // A linked worktree outside the app data dir stays unmanaged.
      const otherDir = path.join(root, "user-worktree");
      git(project, ["worktree", "add", "-b", "feature/user", otherDir, "HEAD"]);
      expect(await repo.isManagedWorktreePath(project, otherDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes the worktree directory and branch", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      await repo.add(project);
      const [worktree] = await repo.list(project);
      await repo.remove(project, worktree);
      expect(await repo.list(project)).toEqual([]);
      expect(() =>
        git(project, ["rev-parse", "--verify", `refs/heads/${worktree.branch}`]),
      ).toThrow();
      // The project's hash dir is cleaned up once it no longer holds worktrees.
      expect(existsSync(path.join(dataDir, hashProjectPath(project)))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes a worktree whose files and directories are read-only", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      await repo.add(project);
      const [worktree] = await repo.list(project);
      // A read-only root dir blocks unlink on POSIX; a read-only file blocks
      // deletion on Windows. Either way removal must still succeed.
      chmodSync(path.join(worktree.path, "file.txt"), 0o444);
      chmodSync(worktree.path, 0o555);
      await repo.remove(project, worktree);
      expect(await repo.list(project)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prunes stale entries when the worktree directory was deleted manually", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      await repo.add(project);
      const [worktree] = await repo.list(project);
      rmSync(worktree.path, { recursive: true, force: true });
      await expect(repo.remove(project, worktree)).resolves.toBeUndefined();
      expect(await repo.list(project)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to remove the main worktree and leaves the main branch intact", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      await expect(
        repo.remove(project, { branch: "main", head: null, path: project }),
      ).rejects.toThrow("Cannot remove the main worktree");
      // The main branch must not have been force-deleted.
      expect(() => git(project, ["rev-parse", "--verify", "refs/heads/main"])).not.toThrow();
      expect(await repo.list(project)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to remove a worktree the app does not manage", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      // A linked worktree created outside the app data dir.
      const otherDir = path.join(root, "user-worktree");
      git(project, ["worktree", "add", "-b", "feature/user", otherDir, "HEAD"]);
      await expect(
        repo.remove(project, { branch: "feature/user", head: null, path: otherDir }),
      ).rejects.toThrow("Only app-managed worktrees can be removed");
      // The worktree and its branch are untouched.
      expect(existsSync(otherDir)).toBe(true);
      expect(() =>
        git(project, ["rev-parse", "--verify", "refs/heads/feature/user"]),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not delete the branch when worktree removal fails while the tree still exists", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({
        dataDir,
        runGit: async (args, options) => {
          if (args[0] === "worktree" && args[1] === "remove") {
            throw new Error("fatal: failed to remove worktree (permissions)");
          }
          return runGit(args, options);
        },
      });
      await repo.add(project);
      const [worktree] = await repo.list(project);
      // The tree still exists, so removal must fail and leave the branch alone.
      await expect(repo.remove(project, worktree)).rejects.toThrow(
        "fatal: failed to remove worktree (permissions)",
      );
      expect(existsSync(worktree.path)).toBe(true);
      expect(() =>
        git(project, ["rev-parse", "--verify", `refs/heads/${worktree.branch}`]),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports the current branch of the main worktree", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      const repo = new WorktreeRepository({ dataDir });
      expect(await repo.mainBranch(project)).toBe("main");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when the main worktree is in detached HEAD", async () => {
    const { root, project, dataDir } = createRepo();
    try {
      git(project, ["checkout", "--detach", "HEAD"]);
      const repo = new WorktreeRepository({ dataDir });
      expect(await repo.mainBranch(project)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when the project is not a git repository", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-worktree-"));
    try {
      const repo = new WorktreeRepository({ dataDir: path.join(root, "worktrees") });
      expect(await repo.mainBranch(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when the project is not a git repository", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-worktree-"));
    try {
      const repo = new WorktreeRepository({ dataDir: path.join(root, "worktrees") });
      await expect(repo.add(root)).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
