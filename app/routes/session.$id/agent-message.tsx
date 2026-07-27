import type { AgentMessage as Data } from "@earendil-works/pi-agent-core";

import { AssistantMessage, type Props as AssistantMessageProps } from "./assistant-message";
import { ToolResultMessage, type Props as ToolResultMessageProps } from "./tool-result-message";
import { UserMessage, type Props as UserMessageProps } from "./user-message";

type SupportedProps = UserMessageProps | AssistantMessageProps | ToolResultMessageProps;

export type Props = SupportedProps | { role: Exclude<Data["role"], SupportedProps["role"]> };

export function AgentMessage(props: Props) {
  switch (props.role) {
    case "user":
      return <UserMessage {...props} />;
    case "assistant":
      return <AssistantMessage {...props} />;
    case "toolResult":
      return <ToolResultMessage {...props} />;
    default:
      return null;
  }
}
