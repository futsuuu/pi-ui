import { createContext } from "react-router";

import type { AgentSessionContainer } from "./agent-session-container";
import type { WorkspaceRepository } from "./workspace-repository";

export const agentSessionContainerContext = createContext<AgentSessionContainer>();
export const workspaceRepositoryContext = createContext<WorkspaceRepository>();
