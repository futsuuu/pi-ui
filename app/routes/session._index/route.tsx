import { Plus, Clock, Layers, Sun, Moon } from "lucide-react";
import { Link, redirect, useLoaderData } from "react-router";

import { useTheme } from "~/contexts/theme";
import { agentSessionContainerContext, projectRepositoryContext } from "~/router-contexts";

import type { Route } from "./+types/route";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Sessions" }];
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
  const sessions = await sessionContainer.listInfo(dir);
  const sorted = sessions.sort((a, b) => b.timestamp - a.timestamp);
  return { sessions: sorted, cwd: dir };
}

export default function Sessions() {
  const { theme, toggleTheme } = useTheme();
  const { sessions, cwd } = useLoaderData<typeof loader>();

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
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Resume an existing session or start a new one.
          </p>
          <Link
            to={newSessionHref}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Session
          </Link>
        </div>

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
            {sessions.map((session) => (
              <Link
                key={session.id}
                to={`/session/${encodeURIComponent(session.id)}`}
                className="block w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {session.firstMessage || "Untitled Session"}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {formatDate(session.timestamp)} · {session.messageCount} messages
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
