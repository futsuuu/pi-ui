import { redirect } from "react-router";

import { projectRepositoryContext, worktreeRepositoryContext } from "~/router-contexts";

import type { Route } from "./+types/route";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Sessions" }];
}

/**
 * Redirect a linked worktree URL to its repository's main worktree and
 * register the browsed directory as a recently used project.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const dir = new URL(request.url).searchParams.get("dir");
  if (dir) {
    const worktreeRepository = context.get(worktreeRepositoryContext);
    const canonicalDir = worktreeRepository.canonicalize(dir);
    const [linkedWorktrees, mainDir] = await Promise.all([
      worktreeRepository.list(dir).catch(() => []),
      worktreeRepository.mainPath(dir),
    ]);
    if (linkedWorktrees.some((worktree) => worktree.path === canonicalDir)) {
      throw redirect(`/session?dir=${encodeURIComponent(mainDir)}`);
    }
    await context.get(projectRepositoryContext).add(canonicalDir);
  }
  return null;
}

export default function NoSessionSelected() {
  return (
    <div className="h-full flex items-center justify-center px-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">Select a session from the sidebar.</p>
    </div>
  );
}
