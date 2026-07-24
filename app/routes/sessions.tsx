import { Plus, Clock, Layers, Sun, Moon } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useTheme } from "~/lib/theme-context";

import type { Route } from "./+types/sessions";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Sessions" }];
}

interface SessionInfo {
  id: string;
  path: string;
  firstMessage: string;
  messageCount: number;
  timestamp: number;
}

export default function Sessions() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { theme, toggleTheme } = useTheme();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [, setCurrentCwd] = useState("");

  // Read working directory from URL
  const dirFromUrl = searchParams.get("dir");

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/pi/sessions");
      const data = await res.json();
      const sorted = (data.sessions || []).sort(
        (a: SessionInfo, b: SessionInfo) => b.timestamp - a.timestamp,
      );
      setSessions(sorted);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    init().catch(console.error);
  }, []);

  async function init() {
    // Fetch current state first
    try {
      const stateRes = await fetch("/api/pi/state");
      const state = await stateRes.json();
      setCurrentCwd(state.cwd || "");

      // If URL has a dir param that differs from server's cwd, change cwd first
      if (dirFromUrl && dirFromUrl !== state.cwd) {
        await fetch("/api/pi/change-cwd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: dirFromUrl }),
        });
      }
    } catch (err) {
      console.error(err);
    }

    // If no dir in URL but server has cwd, redirect to include it
    if (!dirFromUrl) {
      try {
        const stateRes = await fetch("/api/pi/state");
        const state = await stateRes.json();
        if (state.cwd) {
          void navigate(`/sessions?dir=${encodeURIComponent(state.cwd)}`, { replace: true });
          return;
        } else {
          // No cwd at all, redirect to home
          void navigate("/", { replace: true });
          return;
        }
      } catch {
        void navigate("/", { replace: true });
        return;
      }
    }

    await fetchSessions();
  }

  async function switchSession(sessionPath: string) {
    setSwitching(true);
    try {
      const res = await fetch("/api/pi/switch-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionPath }),
      });
      const data = await res.json();
      const sessionId = data.sessionId;
      if (sessionId) {
        void navigate(`/chat/${encodeURIComponent(sessionId)}`);
      } else {
        void navigate("/chat/unknown");
      }
    } catch (err) {
      console.error(err);
      setSwitching(false);
    }
  }

  async function newSession() {
    setSwitching(true);
    try {
      const res = await fetch("/api/pi/new-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      const sessionId = data.sessionId;
      if (sessionId) {
        void navigate(`/chat/${encodeURIComponent(sessionId)}`);
      } else {
        void navigate("/chat/unknown");
      }
    } catch (err) {
      console.error(err);
      setSwitching(false);
    }
  }

  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  }

  return (
    <div className="min-h-screen flex flex-col">
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
          <button
            onClick={newSession}
            disabled={switching}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16">
            <Clock
              className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600"
              strokeWidth={1.5}
            />
            <p className="text-gray-500 dark:text-gray-400 mb-2">No previous sessions</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
              Start a new chat session to begin working with Pi
            </p>
            <button
              onClick={newSession}
              disabled={switching}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Start Chatting
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => switchSession(session.path)}
                disabled={switching}
                className="w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all disabled:opacity-50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {session.firstMessage || "Untitled Session"}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono truncate">
                      {session.id.slice(0, 12)}...
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(session.timestamp)}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {session.messageCount} messages
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
