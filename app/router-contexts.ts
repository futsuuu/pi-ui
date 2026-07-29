import { createContext } from "react-router";

import type { WorkspaceRepository } from "./workspace-repository";

export const workspaceRepositoryContext = createContext<WorkspaceRepository>();
