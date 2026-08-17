import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AgentSessionContainer } from "~/agent-session-container";
import { agentSessionContainerContext } from "~/router-contexts";

import { loader } from "./route";
import { agentSessionContext } from "./router-contexts";

/** Real runtime factory mirroring production. */
const realFactory: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  agentDir,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd, agentDir });
  const result = await createAgentSessionFromServices({
    services,
    sessionManager,
    sessionStartEvent,
    model: getModel("anthropic", "claude-opus-4-5"),
  });
  return { ...result, services, diagnostics: services.diagnostics };
};

/** Redirect the session storage dir so tests never touch the real ~/.pi/agent. */
function withAgentDir(agentDir: string, fn: () => Promise<void>): Promise<void> {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return fn().finally(() => {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  });
}

function callLoader(
  container: AgentSessionContainer,
  sessionId: string,
): ReturnType<typeof loader> {
  const context = new RouterContextProvider();
  return container.get(sessionId).then((session) => {
    if (!session) throw new Error(`session ${sessionId} not found`);
    // The production loader reads the session through the route middleware;
    // the test supplies it directly.
    context.set(agentSessionContext, session);
    context.set(agentSessionContainerContext, container);
    return loader({
      request: new Request(`http://localhost/session/${sessionId}`),
      url: new URL(`http://localhost/session/${sessionId}`),
      params: { id: sessionId },
      pattern: "/session/:id",
      context,
    });
  });
}

describe("GET /session/:id loader", () => {
  it("returns the container's turn buffer as turnEvents", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-route-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.create(cwd);

        const data = await callLoader(container, session.sessionId);
        expect(data.messages).toBe(session.messages);
        // The loader forwards the container's buffer reference unchanged, so
        // whatever the container holds (empty or in-flight turn) is delivered.
        expect(data.turnEvents).toBe(container.getTurnEvents(session.sessionId));
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns an empty turn buffer for an idle session", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-ui-route-"));
    try {
      await withAgentDir(root, async () => {
        const cwd = path.join(root, "cwd");
        mkdirSync(cwd, { recursive: true });
        const container = AgentSessionContainer.withFactory(realFactory);
        const session = await container.create(cwd);

        const data = await callLoader(container, session.sessionId);
        expect(data.turnEvents).toEqual([]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
