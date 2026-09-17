import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { SessionActivityEvent } from "./session-contracts";

export function toSessionActivityEvent(event: AgentSessionEvent): SessionActivityEvent {
  switch (event.type) {
    case "agent_start":
    case "agent_end":
    case "agent_settled":
    case "turn_start":
    case "turn_end":
    case "message_start":
    case "message_update":
    case "message_end":
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
    case "queue_update":
    case "compaction_start":
    case "compaction_end":
    case "entry_appended":
    case "session_info_changed":
    case "thinking_level_changed":
    case "auto_retry_start":
    case "auto_retry_end":
    case "summarization_retry_scheduled":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
    case "bash_execution_update":
      return { ...event };
    default:
      event satisfies never;
      throw new Error("Unsupported session event");
  }
}
