import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, readdir, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Worktree {
  /** Branch name, or null when the worktree is in detached HEAD. */
  branch: string | null;
  /** Short commit sha, present when the worktree is in detached HEAD. */
  head: string | null;
  path: string;
}

const ADJECTIVES = [
  "agile",
  "bold",
  "calm",
  "clever",
  "cozy",
  "crisp",
  "daring",
  "eager",
  "fancy",
  "fierce",
  "gentle",
  "happy",
  "humble",
  "jolly",
  "keen",
  "lively",
  "lucky",
  "mellow",
  "merry",
  "mighty",
  "nimble",
  "noble",
  "playful",
  "proud",
  "quick",
  "quiet",
  "radiant",
  "rapid",
  "sharp",
  "silent",
  "sleek",
  "smart",
  "smooth",
  "sturdy",
  "swift",
  "wise",
  "witty",
  "zesty",
];

const NOUNS = [
  "badger",
  "beaver",
  "breeze",
  "canyon",
  "comet",
  "coral",
  "dolphin",
  "falcon",
  "fern",
  "fox",
  "galaxy",
  "gopher",
  "harbor",
  "heron",
  "horizon",
  "jaguar",
  "lantern",
  "lotus",
  "meadow",
  "meteor",
  "mosaic",
  "otter",
  "panther",
  "pebble",
  "pine",
  "pond",
  "rabbit",
  "raven",
  "river",
  "robin",
  "rock",
  "salmon",
  "sparrow",
  "stone",
  "stream",
  "tiger",
  "turtle",
  "valley",
  "willow",
  "wolf",
];

export function generateBranchName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `pi/${adjective}-${noun}`;
}

/**
 * Resolve a path to its OS-canonical form: on Windows this expands 8.3 short
 * names (`RUNNER~1` -> `runneradmin`) and canonicalizes case, so paths that
 * refer to the same directory always hash and compare equal. Falls back to a
 * plain resolve when the path does not exist (e.g. a stale worktree entry).
 */
function resolvePath(p: string): string {
  try {
    return realpathSync.native(p);
  } catch (error) {
    // Only "path does not exist" errors can safely fall back to a plain
    // resolve; anything else (permission errors, etc.) should surface rather
    // than silently produce a non-canonical path.
    const code =
      error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "ENOENT" || code === "ENOTDIR") {
      return path.resolve(p);
    }
    throw error;
  }
}

/**
 * Recursive `chmod -R u+w` equivalent: add the owner-write bit to every file
 * and directory under `dir` so the working tree can be deleted. Symlinks are
 * skipped (their permissions are irrelevant and `chmod -R` does not follow
 * them). Throws on the first failure; callers that treat it as best-effort
 * should catch — `git worktree remove` remains the authority on whether the
 * removal can proceed.
 */
export async function makeWritable(dir: string): Promise<void> {
  const stats = await lstat(dir);
  await chmod(dir, stats.mode | 0o200);
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink()) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await makeWritable(full);
      } else {
        await chmod(full, (await lstat(full)).mode | 0o200);
      }
    }),
  );
}

/** Short hash of a project path, used to namespace each project's worktrees. */
export function hashProjectPath(projectPath: string): string {
  return createHash("sha256").update(resolvePath(projectPath)).digest("hex").slice(0, 12);
}

export type RunGit = (args: string[], options?: { cwd?: string }) => Promise<string>;

function defaultDataDir(): string {
  const base = process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, "pi-ui")
    : path.join(homedir(), ".local", "share", "pi-ui");
  return path.join(base, "worktrees");
}

function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  for (const block of output.trim().split(/\n\n+/)) {
    if (!block) continue;
    let worktreePath: string | undefined;
    let branch: string | undefined;
    let head: string | undefined;
    let detached = false;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length);
      } else if (line.startsWith("branch refs/heads/")) {
        branch = line.slice("branch refs/heads/".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length).slice(0, 7);
      } else if (line === "detached") {
        detached = true;
      }
    }
    if (!worktreePath || (!branch && !detached)) continue;
    worktrees.push({
      branch: branch ?? null,
      head: detached ? (head ?? null) : null,
      path: resolvePath(worktreePath),
    });
  }
  return worktrees;
}

/**
 * Manages git worktrees for projects. New worktrees are created with a
 * random `pi/<adjective>-<noun>` branch under an app-specific data
 * directory, but no metadata is persisted: the current worktree state is
 * read from `git worktree list` on every call, and the list includes
 * worktrees created outside the app directory, as well as linked worktrees
 * in detached HEAD.
 */
export class WorktreeRepository {
  private readonly dataDir: string;
  private readonly runGit: RunGit;

  public constructor(options: { dataDir?: string; runGit?: RunGit } = {}) {
    this.dataDir = options.dataDir ?? defaultDataDir();
    this.runGit =
      options.runGit ??
      (async (args, options = {}) => {
        try {
          const { stdout } = await execFileAsync("git", args, {
            cwd: options.cwd,
            encoding: "utf8",
          });
          return stdout;
        } catch (error) {
          const stderr =
            error instanceof Error && "stderr" in error
              ? String((error as { stderr: unknown }).stderr)
              : "";
          throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
        }
      });
  }

  /**
   * Resolve the repository root (toplevel) of a project, falling back to the
   * given path when it is not inside a git repository. `git worktree list`
   * always reports the main worktree at the toplevel, so comparing against it
   * excludes the main worktree even when the project was opened from a
   * subdirectory.
   */
  private async toplevel(projectPath: string): Promise<string> {
    let root: string | undefined;
    try {
      const output = await this.runGit(["rev-parse", "--show-toplevel"], {
        cwd: projectPath,
      });
      root = output.trim();
    } catch {}
    return resolvePath(root || projectPath);
  }

  /**
   * Directory under the data dir that holds this project's worktrees.
   * Canonicalized (realpath) so it compares equal to the paths git reports
   * for the worktrees it holds; on Windows the data dir may sit under a
   * base with 8.3 short names (RUNNER~1) or non-canonical case.
   */
  public async projectDir(projectPath: string): Promise<string> {
    return resolvePath(path.join(this.dataDir, hashProjectPath(await this.toplevel(projectPath))));
  }

  /**
   * OS-canonical form of a path (realpath when it exists, plain resolve
   * otherwise) — the same normalization {@link list} applies to git's
   * output. Use it to compare client-supplied paths (which on Windows may
   * use 8.3 short names or non-canonical case) against listed worktrees.
   */
  public canonicalize(p: string): string {
    return resolvePath(p);
  }

  /**
   * Current branch of the main worktree (project root), or null when the
   * project is not a git repository or is in detached HEAD.
   */
  public async mainBranch(projectPath: string): Promise<string | null> {
    try {
      const output = await this.runGit(["branch", "--show-current"], { cwd: projectPath });
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  /** Path of the main worktree (repository toplevel) for a project. */
  public async mainPath(projectPath: string): Promise<string> {
    return this.toplevel(projectPath);
  }

  /** List the linked worktrees of a project, excluding the main worktree. */
  public async list(projectPath: string): Promise<Worktree[]> {
    await this.runGit(["worktree", "prune"], { cwd: projectPath }).catch(() => {});
    const [output, mainPath] = await Promise.all([
      this.runGit(["worktree", "list", "--porcelain"], { cwd: projectPath }),
      this.toplevel(projectPath),
    ]);
    return parseWorktreeList(output).filter((worktree) => worktree.path !== mainPath);
  }

  /**
   * Create a new worktree with a random `pi/<adjective>-<noun>` branch in the
   * app data directory. Returns the created worktree.
   */
  public async add(projectPath: string): Promise<Worktree> {
    await mkdir(this.dataDir, { recursive: true });
    for (let i = 0; i < 10; i++) {
      const branch = generateBranchName();
      if (await this.branchExists(projectPath, branch)) continue;
      const worktreePath = path.join(
        await this.projectDir(projectPath),
        branch.replace(/^pi\//, ""),
      );
      try {
        await this.runGit(["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
          cwd: projectPath,
        });
        return { branch, head: null, path: resolvePath(worktreePath) };
      } catch (error) {
        // A concurrent request may have grabbed the same branch name.
        if (error instanceof Error && error.message.includes("already exists")) continue;
        throw error;
      }
    }
    throw new Error("Could not generate a unique worktree branch name");
  }

  /**
   * Whether a worktree path is managed by the app, i.e. created under this
   * repository's per-project data dir. Only managed worktrees are removed by
   * {@link remove}; linked worktrees the user created elsewhere are listed
   * but left alone so a stray click can never destroy them.
   *
   * Pass a pre-resolved `projectDir` to avoid resolving the toplevel again
   * when the caller already knows it.
   */
  public async isManagedWorktreePath(
    projectPath: string,
    worktreePath: string,
    projectDir?: string,
  ): Promise<boolean> {
    const dir = resolvePath(projectDir ?? (await this.projectDir(projectPath)));
    const resolved = resolvePath(worktreePath);
    return resolved === dir || resolved.startsWith(dir + path.sep);
  }

  /**
   * Remove a worktree: deletes the working tree and its branch. If the working
   * tree directory no longer exists, falls back to pruning stale bookkeeping.
   * Only app-managed worktrees can be removed, and the main worktree is always
   * refused, so a remove can never destroy a branch the app did not create.
   */
  public async remove(projectPath: string, worktree: Worktree): Promise<void> {
    if (path.resolve(worktree.path) === path.resolve(await this.toplevel(projectPath))) {
      throw new Error("Cannot remove the main worktree");
    }
    if (!(await this.isManagedWorktreePath(projectPath, worktree.path))) {
      throw new Error("Only app-managed worktrees can be removed");
    }
    // Best-effort chmod -R u+w: POSIX needs the write bit on directories to
    // unlink their children, while Windows needs it on files to drop the
    // read-only attribute that blocks deletion. One pass covers both.
    await makeWritable(worktree.path).catch(() => {});
    try {
      await this.runGit(["worktree", "remove", "--force", worktree.path], {
        cwd: projectPath,
      });
    } catch (error) {
      // Only stale bookkeeping (the working tree is already gone) falls back to
      // prune; any other failure aborts before the branch is touched.
      if (existsSync(worktree.path)) {
        throw error;
      }
      // A failed prune leaves the registration behind; surface it rather than
      // delete the branch underneath a stale entry.
      await this.runGit(["worktree", "prune"], { cwd: projectPath });
    }
    if (worktree.branch) {
      // Confirm git's bookkeeping no longer lists the worktree before deleting
      // its branch, so a stale registration can never lose a checked-out branch.
      const stillRegistered = parseWorktreeList(
        await this.runGit(["worktree", "list", "--porcelain"], { cwd: projectPath }),
      ).some((entry) => entry.path === worktree.path);
      if (stillRegistered) {
        throw new Error("Worktree is still registered after removal");
      }
      await this.runGit(["branch", "--delete", "--force", worktree.branch], {
        cwd: projectPath,
      }).catch(() => {});
    }
    await rmdir(await this.projectDir(projectPath)).catch(() => {});
  }

  private async branchExists(projectPath: string, branch: string): Promise<boolean> {
    try {
      await this.runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
        cwd: projectPath,
      });
      return true;
    } catch {
      return false;
    }
  }
}
