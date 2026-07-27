import { Folder, ArrowLeft, File, Layers, Sun, Moon, ArrowRight } from "lucide-react";
import { useCallback } from "react";
import { useLoaderData, useNavigate } from "react-router";

import { getPiServer } from "~/lib/pi-server";
import { useTheme } from "~/lib/theme-context";

import type { Route } from "./+types/_index";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Select Directory" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const pi = getPiServer();

  const url = new URL(request.url);
  const dirFromUrl = url.searchParams.get("dir");

  const homeDir = pi.getHomeDir();
  const recentDirs = pi.getRecentDirs();
  const currentDir = dirFromUrl || homeDir;
  const entries = await pi.listDirectory(currentDir);

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
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { homeDir, recentDirs, currentDir, entries, breadcrumbs } = useLoaderData<typeof loader>();

  const loadDir = useCallback(
    (dirPath: string) => {
      void navigate(`/?dir=${encodeURIComponent(dirPath)}`, { replace: true });
    },
    [navigate],
  );

  function selectDir(dirPath: string) {
    void navigate(`/session?dir=${encodeURIComponent(dirPath)}`);
  }

  function goUp() {
    const parent = currentDir.substring(0, currentDir.lastIndexOf("/")) || "/";
    loadDir(parent);
  }

  function goToHome() {
    loadDir(homeDir);
  }

  return (
    <div className="min-h-screen flex flex-col">
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
                <button
                  key={dir.path}
                  onClick={() => selectDir(dir.path)}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors truncate flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                >
                  <Folder className="w-4 h-4 flex-shrink-0 text-amber-500" />
                  <span className="truncate">{dir.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Directory Picker */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-1 p-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-x-auto">
            <button
              onClick={goToHome}
              className="px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0"
            >
              ~
            </button>
            <span className="text-gray-400 flex-shrink-0">/</span>
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center gap-1 flex-shrink-0">
                {i > 0 && <span className="text-gray-400">/</span>}
                {i < breadcrumbs.length - 1 ? (
                  <button
                    onClick={() => loadDir(crumb.path)}
                    className="px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                  >
                    {crumb.name}
                  </button>
                ) : (
                  <span className="px-2 py-1 text-xs font-medium text-gray-900 dark:text-gray-100">
                    {crumb.name}
                  </span>
                )}
              </span>
            ))}
          </div>

          <div className="max-h-80 overflow-y-auto">
            <button
              onClick={goUp}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm flex items-center gap-2 border-b border-gray-100 dark:border-gray-800"
            >
              <ArrowLeft className="w-4 h-4" />
              ..
            </button>
            {entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => (entry.isDirectory ? loadDir(entry.path) : null)}
                className={`w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm flex items-center gap-2 ${
                  entry.isDirectory ? "" : "cursor-default"
                }`}
              >
                {entry.isDirectory ? (
                  <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                ) : (
                  <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
                )}
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
            {entries.length === 0 && (
              <p className="px-4 py-8 text-center text-gray-400 text-sm">Empty directory</p>
            )}
          </div>

          <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
            <button
              onClick={() => selectDir(currentDir)}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              Use This Directory
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
