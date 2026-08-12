import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/**
 * Current info for one session as carried by the global `/events` SSE stream.
 */
export interface SessionInfo {
  id: string;
  /** Working directory the session belongs to (for project filtering). */
  cwd: string;
  /** User-defined display name from session_info entries. */
  name: string | null;
  firstMessage: string;
  messageCount: number;
  /** Last modified time (epoch ms). */
  timestamp: number;
  model: { name: string; provider: string; id: string } | null;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
}
