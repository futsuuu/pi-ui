import { Folder, ArrowLeft, File, ArrowRight, Layers, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useTheme } from "~/lib/theme-context";

import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Select Directory" }];
}

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface RecentDir {
  path: string;
  lastOpened: number;
}

export default function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { theme, toggleTheme } = useTheme();
  const [currentCwd, setCurrentCwd] = useState("");
  const [currentDir, setCurrentDir] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [recentDirs, setRecentDirs] = useState<RecentDir[]>([]);
  const [homeDir, setHomeDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState<{ name: string; path: string }[]>([]);

  useEffect(() => {
    loadInitial().catch(console.error);
  }, []);

  async function loadInitial() {
    setLoading(true);
    try {
      const [stateRes, homeRes] = await Promise.all([
        fetch("/api/pi/state"),
        fetch("/api/fs/home-dir"),
      ]);
      const state = await stateRes.json();
      const home = await homeRes.json();

      setCurrentCwd(state.cwd || "");

      // Start from the dir passed in URL, or current cwd, or home
      const dirFromUrl = searchParams.get("dir");
      const startDir = dirFromUrl || state.cwd || home.homeDir;
      setCurrentDir(startDir);
      setHomeDir(home.homeDir);
      setRecentDirs(home.recentDirs || []);

      await loadDir(startDir);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadDir(dirPath: string) {
    setCurrentDir(dirPath);
    try {
      const res = await fetch(`/api/fs/dirs?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setEntries([]);
    }

    const parts = dirPath.split("/").filter(Boolean);
    const crumbs: { name: string; path: string }[] = [];
    let cum = "";
    for (const part of parts) {
      cum += "/" + part;
      crumbs.push({ name: part, path: cum });
    }
    if (crumbs.length === 0) crumbs.push({ name: "/", path: "/" });
    setBreadcrumbs(crumbs);
  }

  async function selectDir(dirPath: string) {
    setSelecting(true);
    try {
      await fetch("/api/pi/change-cwd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: dirPath }),
      });
      void navigate(`/sessions?dir=${encodeURIComponent(dirPath)}`);
    } catch (err) {
      console.error(err);
      setSelecting(false);
    }
  }

  function goUp() {
    const parent = currentDir.substring(0, currentDir.lastIndexOf("/")) || "/";
    void loadDir(parent);
  }

  function goToHome() {
    void loadDir(homeDir);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
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
        {currentCwd && (
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-6">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <span className="font-medium">Current:</span> {currentCwd}
            </p>
          </div>
        )}

        {/* Recent Directories */}
        {recentDirs.length > 0 && !currentCwd && (
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
              disabled={selecting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {selecting ? "Setting..." : "Use This Directory"}
              {!selecting && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
