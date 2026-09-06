import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createContext } from "react-router";

import type { AgentSessionContainer } from "./agent-session-container";
import type { ProjectRepository } from "./project-repository";
import type { WorktreeRepository } from "./worktree-repository";

export const agentSessionContainerContext = createContext<AgentSessionContainer>();
export const modelRuntimeContext = createContext<ModelRuntime>();
export const projectRepositoryContext = createContext<ProjectRepository>();
export const worktreeRepositoryContext = createContext<WorktreeRepository>();
