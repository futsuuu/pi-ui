import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";

import {
  SessionManager,
  type ModelRuntime,
  type SessionInfo as PersistedSessionInfo,
} from "@earendil-works/pi-coding-agent";

import type {
  SessionDeleteHints,
  SessionListInfo,
  SessionLookupHints,
  SessionRepository,
  SessionSnapshot,
  SessionThinkingLevel,
} from "./session-contracts";

const execFileAsync = promisify(execFile);
const THINKING_LEVELS = new Set<SessionThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

async function deleteSessionFile(sessionPath: string): Promise<void> {
  const args = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
  let trashHint: string | null = null;
  try {
    await execFileAsync("trash", args);
    if (!existsSync(sessionPath)) return;
    trashHint = "trash reported success but the session file is still present";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const stderr =
      error instanceof Error && "stderr" in error
        ? (String((error as { stderr: unknown }).stderr)
            .trim()
            .split("\n")[0] ?? "")
        : "";
    const detail = stderr || message;
    if (detail) trashHint = `trash: ${detail.slice(0, 200)}`;
  }
  try {
    await unlink(sessionPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(trashHint ? `${message} (${trashHint})` : message);
  }
}

export class SdkSessionRepository implements SessionRepository {
  constructor(private readonly modelRuntime?: ModelRuntime) {}

  async listInfo(dir: string): Promise<SessionListInfo[]> {
    const sessions = await SessionManager.list(dir);
    return sessions.map((session) => ({
      id: session.id,
      firstMessage: session.firstMessage.slice(0, 100),
      messageCount: session.messageCount,
      timestamp: session.modified.getTime(),
    }));
  }

  async findSessionCwd(sessionId: string): Promise<string | null> {
    const infos = await SessionManager.listAll();
    return infos.find((info) => info.id === sessionId)?.cwd ?? null;
  }

  async read(sessionId: string, hints: SessionLookupHints = {}): Promise<SessionSnapshot | null> {
    const info = await this.findInfo(sessionId, hints);
    if (!info) return null;
    const sessionManager = this.open(info.path);
    const context = sessionManager.buildSessionContext();
    const configuredModel = context.model
      ? this.modelRuntime?.getModel(context.model.provider, context.model.modelId)
      : undefined;
    const thinkingLevel = THINKING_LEVELS.has(context.thinkingLevel as SessionThinkingLevel)
      ? (context.thinkingLevel as SessionThinkingLevel)
      : "medium";
    return {
      id: info.id,
      cwd: info.cwd,
      messages: context.messages,
      state: {
        model: context.model
          ? {
              name: configuredModel?.name ?? context.model.modelId,
              provider: context.model.provider,
              id: context.model.modelId,
            }
          : null,
        thinkingLevel,
        isStreaming: false,
        isCompacting: false,
        contextUsage: null,
      },
    };
  }

  async delete(sessionId: string, hints: SessionDeleteHints): Promise<void> {
    const found = await this.findInfo(sessionId, hints);
    if (!found) throw new Error(`Session ${JSON.stringify(sessionId)} not found`);
    await this.deletePath(found.path);
  }

  create(cwd: string): SessionManager {
    return SessionManager.create(cwd);
  }

  open(sessionPath: string): SessionManager {
    return SessionManager.open(sessionPath);
  }

  listAll(): Promise<PersistedSessionInfo[]> {
    return SessionManager.listAll();
  }

  async findInfo(
    sessionId: string,
    hints: SessionLookupHints,
  ): Promise<PersistedSessionInfo | null> {
    const infos = hints.cwd
      ? await SessionManager.list(hints.cwd, hints.sessionDir)
      : await SessionManager.listAll();
    return infos.find((info) => info.id === sessionId) ?? null;
  }

  deletePath(sessionPath: string): Promise<void> {
    return deleteSessionFile(sessionPath);
  }
}
