import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createContext } from "react-router";

export const agentSessionContext = createContext<AgentSession>();
