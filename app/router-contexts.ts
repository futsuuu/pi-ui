import { createContext } from "react-router";

import type { AgentSessionContainer } from "./agent-session-container";
import type { ProjectRepository } from "./project-repository";

export const agentSessionContainerContext = createContext<AgentSessionContainer>();
export const projectRepositoryContext = createContext<ProjectRepository>();
