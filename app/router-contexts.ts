import { createContext } from "react-router";

import type { AgentSessionContainer } from "./agent-session-container";
import type { ProjectRepository } from "./project-repository";
import type { WorktreeRepository } from "./worktree-repository";

export const agentSessionContainerContext = createContext<AgentSessionContainer>();
export const projectRepositoryContext = createContext<ProjectRepository>();
export const worktreeRepositoryContext = createContext<WorktreeRepository>();
