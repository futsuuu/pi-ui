import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Folder, ArrowLeft, File, Layers, Sun, Moon, ArrowRight } from "lucide-react";
import { Link, useLoaderData } from "react-router";

import { useTheme } from "~/contexts/theme";
import { workspaceRepositoryContext } from "~/router-contexts";

import type { Route } from "./+types/_index";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Select Directory" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const workspaceRepository = context.get(workspaceRepositoryContext);

  const url = new URL(request.url);
  const dirFromUrl = url.searchParams.get("dir");

  const homeDir = homedir();
  const recentDirs = workspaceRepository.list();
  const currentDir = dirFromUrl || homeDir;

  let entries: { name: string; path: string; isDirectory: boolean }[] = [];
  try {
    const dirents = await readdir(currentDir, { withFileTypes: true });
    entries = dirents
      .map((e) => ({
        name: e.name,
        path: path.join(currentDir, e.name),
        isDirectory: e.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    entries = [];
  }

  // Build breadcrumbs from currentDir
  const parts = currentDir.split("/").filter(Boolean);
  const breadcrumbs: { name: string; path: string }[] = [];
  let cum = "";
  for (const part of parts) {
    cum += "/" + part;
    breadcrumbs.push({ name: part, path: cum });
  }
  if (breadcrumbs.length === 0) breadcrumbs.push({ name: "/", path: "/" });

  return { homeDir, recentDirs, currentDir, entries, breadcrumbs };
}

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const { homeDir, recentDirs, currentDir, entries, breadcrumbs } = useLoaderData<typeof loader>();

  const parentDir = currentDir.substring(0, currentDir.lastIndexOf("/")) || "/";

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Layers className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Select Working Directory
          </span>
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
        {/* Recent Directories */}
        {recentDirs.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Recent Directories
            </h2>
            <div className="space-y-1">
              {recentDirs.map((dir) => (
                <Link
                  key={dir.path}
                  to={`/session?dir=${encodeURIComponent(dir.path)}`}
                  className="block w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors truncate flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                >
                  <Folder className="w-4 h-4 flex-shrink-0 text-amber-500" />
                  <span className="truncate">{dir.path}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Directory Picker */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-1 p-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-x-auto">
            <Link
              to={`/?dir=${encodeURIComponent(homeDir)}`}
              replace
              className="px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0"
            >
              ~
            </Link>
            <span className="text-gray-400 flex-shrink-0">/</span>
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center gap-1 flex-shrink-0">
                {i > 0 && <span className="text-gray-400">/</span>}
                {i < breadcrumbs.length - 1 ? (
                  <Link
                    to={`/?dir=${encodeURIComponent(crumb.path)}`}
                    replace
                    className="px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                  >
                    {crumb.name}
                  </Link>
                ) : (
                  <span className="px-2 py-1 text-xs font-medium text-gray-900 dark:text-gray-100">
                    {crumb.name}
                  </span>
                )}
              </span>
            ))}
          </div>

          <div className="max-h-80 overflow-y-auto">
            <Link
              to={`/?dir=${encodeURIComponent(parentDir)}`}
              replace
              className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm flex items-center gap-2 border-b border-gray-100 dark:border-gray-800"
            >
              <ArrowLeft className="w-4 h-4" />
              ..
            </Link>
            {entries.map((entry) =>
              entry.isDirectory ? (
                <Link
                  key={entry.path}
                  to={`/?dir=${encodeURIComponent(entry.path)}`}
                  replace
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm flex items-center gap-2"
                >
                  <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </Link>
              ) : (
                <div
                  key={entry.path}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 cursor-default text-gray-500"
                >
                  <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </div>
              ),
            )}
            {entries.length === 0 && (
              <p className="px-4 py-8 text-center text-gray-400 text-sm">Empty directory</p>
            )}
          </div>

          <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
            <Link
              to={`/session?dir=${encodeURIComponent(currentDir)}`}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              Use This Directory
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
