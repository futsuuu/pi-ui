import { createContext, useContext } from "react";

export interface PathDisplay {
  cwd: string;
  home: string;
}

const PathDisplayContext = createContext<PathDisplay>({ cwd: "", home: "" });

export function usePathDisplay(): PathDisplay {
  return useContext(PathDisplayContext);
}

export const PathDisplayProvider = PathDisplayContext.Provider;
