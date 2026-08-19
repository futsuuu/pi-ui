import { getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";

/**
 * Real runtime factory mirroring production, used to exercise loaded
 * sessions. Pins a reasoning model so `setThinkingLevel` is not clamped to
 * "off" by the default (non-reasoning) model.
 */
export const realFactory: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  agentDir,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd, agentDir });
  const result = await createAgentSessionFromServices({
    services,
    sessionManager,
    sessionStartEvent,
    model: getModel("anthropic", "claude-opus-4-5"),
  });
  return { ...result, services, diagnostics: services.diagnostics };
};

/**
 * Runs an asynchronous callback with the agent directory temporarily configured.
 *
 * @param agentDir - The directory to use for agent session storage.
 * @param fn - The callback to run while the directory is configured.
 */
export async function withAgentDir(agentDir: string, fn: () => Promise<void>): Promise<void> {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await fn();
  } finally {
    if (previous === undefined) {
      // Assignment would store the string "undefined"; delete to unset.
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  }
}

/**
 * Creates an empty token usage and cost summary.
 *
 * @returns A token usage and cost object with all values set to `0`
 */
export function usage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Create a persisted session with one user/assistant turn and return its id
 * and file path. Uses the default session dir (under the current
 * PI_CODING_AGENT_DIR) when `sessionDir` is omitted. Session files are only
 * written once an assistant message arrives, so append a user message
 * followed by an assistant reply.
 */
export function createSession(cwd: string, sessionDir?: string): { id: string; file: string } {
  const sm = SessionManager.create(cwd, sessionDir);
  const timestamp = Date.now();
  sm.appendMessage({ role: "user", content: "hello", timestamp });
  sm.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Hi there!" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: usage(),
    stopReason: "stop",
    timestamp,
  });
  return { id: sm.getSessionId(), file: sm.getSessionFile()! };
}

/**
 * Creates a persisted session containing one user message and one assistant response.
 *
 * @param cwd - The working directory associated with the session
 * @returns An object containing the session ID
 */
export function oneTurnSession(cwd: string): { id: string } {
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "hello", timestamp: 10 });
  sm.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Hi there!" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: usage(),
    stopReason: "stop",
    timestamp: 10,
  });
  return { id: sm.getSessionId() };
}
