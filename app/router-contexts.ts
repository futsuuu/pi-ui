import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createContext } from "react-router";

import type { ProjectRepository } from "./project-repository";
import type { ProviderAuthManager } from "./provider-auth-manager";
import type {
  SessionActivitySource,
  SessionEventHub,
  SessionExecutor,
  SessionRepository,
} from "./session-contracts";
import type { WorktreeRepository } from "./worktree-repository";

export const sessionRepositoryContext = createContext<SessionRepository>();
export const sessionExecutorContext = createContext<SessionExecutor>();
export const sessionActivitySourceContext = createContext<SessionActivitySource>();
export const sessionEventHubContext = createContext<SessionEventHub>();
export const modelRuntimeContext = createContext<ModelRuntime>();
export const providerAuthManagerContext = createContext<ProviderAuthManager>();
export const projectRepositoryContext = createContext<ProjectRepository>();
export const worktreeRepositoryContext = createContext<WorktreeRepository>();
