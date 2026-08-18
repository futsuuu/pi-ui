import { AgentSessionContainer } from "./agent-session-container";
import { ProjectRepository } from "./project-repository";
import { SessionViewStateRepository } from "./session-view-state";
import { WorktreeRepository } from "./worktree-repository";

interface SingletonContainer {
  agentSessionContainer: AgentSessionContainer;
  projectRepository: ProjectRepository;
  worktreeRepository: WorktreeRepository;
}

async function createContainer(): Promise<SingletonContainer> {
  const sessionViewStateRepository = new SessionViewStateRepository();
  return {
    agentSessionContainer: await AgentSessionContainer.create(sessionViewStateRepository),
    projectRepository: new ProjectRepository(),
    worktreeRepository: new WorktreeRepository(),
  };
}

let container: Promise<SingletonContainer>;

declare global {
  var __singletonContainer__: Promise<SingletonContainer> | undefined;
}

if (process.env.NODE_ENV === "production") {
  container = createContainer();
} else {
  globalThis.__singletonContainer__ ??= createContainer();
  container = globalThis.__singletonContainer__;
}

export function getSingletonContainer(): Promise<SingletonContainer> {
  return container;
}
