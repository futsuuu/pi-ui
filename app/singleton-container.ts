import { AgentSessionContainer } from "./agent-session-container";
import { ProjectRepository } from "./project-repository";

interface SingletonContainer {
  agentSessionContainer: AgentSessionContainer;
  projectRepository: ProjectRepository;
}

async function createContainer(): Promise<SingletonContainer> {
  return {
    agentSessionContainer: await AgentSessionContainer.create(),
    projectRepository: new ProjectRepository(),
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
