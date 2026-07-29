import { WorkspaceRepository } from "~/workspace-repository";

interface SingletonContainer {
  workspaceRepository: WorkspaceRepository;
}

async function createContainer(): Promise<SingletonContainer> {
  return {
    workspaceRepository: new WorkspaceRepository(),
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
