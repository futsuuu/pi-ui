import { Plus, Clock, Layers, Sun, Moon } from "lucide-react";
import { useEffect } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import * as v from "valibot";

import { getPiServer } from "~/lib/pi-server";
import { useTheme } from "~/lib/theme-context";
import { SessionPathSchema } from "~/lib/validations";

import type { Route } from "./+types/sessions";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Sessions" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const pi = getPiServer();
  await pi.ensureInitialized();

  const url = new URL(request.url);
  const dirFromUrl = url.searchParams.get("dir");

  // If URL has a dir param that differs from server's cwd, change cwd first
  if (dirFromUrl && dirFromUrl !== pi.cwd) {
    await pi.changeCwd(dirFromUrl);
  }

  // If no dir in URL but server has cwd, redirect will happen client-side via component
  const cwd = pi.cwd;
  const sessions = await pi.getSessionsList();
  const sorted = sessions.sort((a, b) => b.timestamp - a.timestamp);

  return { sessions: sorted, cwd, dirFromUrl };
}

export async function action({ request }: Route.ActionArgs) {
  const pi = getPiServer();
  const body: Record<string, unknown> = await request.json();
  const intent = body.intent as string | undefined;

  if (intent === "new-session") {
    await pi.newSession();
    return { success: true, sessionId: pi.getState().sessionId, action: "new-session" };
  }

  if (intent === "switch-session") {
    const sessionPathRaw = body.sessionPath;
    const parsed = v.safeParse(SessionPathSchema, { sessionPath: sessionPathRaw });
    if (!parsed.success) {
      return { error: "Invalid sessionPath", action: "switch-session" };
    }
    await pi.switchSession(parsed.output.sessionPath);
    return { success: true, sessionId: pi.getState().sessionId, action: "switch-session" };
  }

  return { error: "Unknown intent" };
}

export default function Sessions() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { sessions, cwd, dirFromUrl } = useLoaderData<typeof loader>();

  const fetcher = useFetcher();
  const fetcherData = fetcher.data as
    | { success?: boolean; sessionId?: string; action?: string; error?: string }
    | undefined;

  // Redirect if no dir in URL but we have a cwd
  useEffect(() => {
    if (!dirFromUrl && cwd) {
      void navigate(`/sessions?dir=${encodeURIComponent(cwd)}`, { replace: true });
    }
    if (!dirFromUrl && !cwd) {
      void navigate("/", { replace: true });
    }
  }, [dirFromUrl, cwd, navigate]);

  // Navigate after successful session switch/new
  useEffect(() => {
    if (fetcher.state === "idle" && fetcherData?.sessionId) {
      void navigate(`/chat/${encodeURIComponent(fetcherData.sessionId)}`);
    }
  }, [fetcher.state, fetcherData?.sessionId, navigate]);

  async function switchSession(sessionPath: string) {
    void fetcher.submit(
      { intent: "switch-session", sessionPath },
      { method: "post", encType: "application/json" },
    );
  }

  async function newSession() {
    void fetcher.submit({ intent: "new-session" }, { method: "post", encType: "application/json" });
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

  const switching = fetcher.state !== "idle";

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
