import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createContext, useContext } from "react";

export type ToolCallEntry = { toolName: string; args: unknown };
export type ToolCallMap = Map<string, ToolCallEntry>;

const ToolCallContext = createContext<ToolCallMap>(new Map());

export function useToolCall(toolCallId: string): ToolCallEntry | undefined {
  return useContext(ToolCallContext).get(toolCallId);
}

/** Build a ToolCallMap from AgentMessage[] by extracting toolCall blocks from assistant messages. */
export function buildToolCallMap(messages: AgentMessage[]): ToolCallMap {
  const map = new Map<string, ToolCallEntry>();
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "toolCall") {
          map.set(block.id, { toolName: block.name, args: block.arguments });
        }
      }
    }
  }
  return map;
}

export { ToolCallContext };
