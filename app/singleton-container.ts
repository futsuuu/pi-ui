import { AgentSessionContainer } from "./agent-session-container";
import { ProjectRepository } from "./project-repository";
import { SessionViewStateRepository } from "./session-view-state";
import { WorktreeRepository } from "./worktree-repository";

interface SingletonContainer {
  agentSessionContainer: AgentSessionContainer;
  projectRepository: ProjectRepository;
  worktreeRepository: WorktreeRepository;
}

/**
 * Creates the application container and initializes its repositories.
 *
 * @returns The initialized singleton container
 */
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
  var __singletonContainerCleanupRegistered__: boolean | undefined;
}

if (process.env.NODE_ENV === "production") {
  container = createContainer();
} else {
  globalThis.__singletonContainer__ ??= createContainer();
  container = globalThis.__singletonContainer__;
}

let cleanupPromise: Promise<void> | undefined;

/** Bound on signal-triggered shutdown: never let a hung cleanup block exit. */
const SHUTDOWN_GRACE_MS = 10_000;

export function getSingletonContainer(): Promise<SingletonContainer> {
  return container;
}

export function disposeSingletonContainer(): Promise<void> {
  cleanupPromise ??= container
    .then(({ agentSessionContainer }) => agentSessionContainer.disposeAll())
    .catch(() => undefined);
  return cleanupPromise;
}

const SHUTDOWN_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

if (!globalThis.__singletonContainerCleanupRegistered__) {
  globalThis.__singletonContainerCleanupRegistered__ = true;
  process.once("beforeExit", () => {
    void disposeSingletonContainer();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      const exitCode = SHUTDOWN_EXIT_CODES[signal];
      // The deadline timer keeps the loop alive while cleanup is pending, so a
      // hung runtime dispose cannot block exit beyond the grace period and the
      // exit still carries the signal's expected status.
      const forceExit = setTimeout(() => process.exit(exitCode), SHUTDOWN_GRACE_MS);
      void disposeSingletonContainer().finally(() => {
        clearTimeout(forceExit);
        process.exit(exitCode);
      });
    });
  }
}
