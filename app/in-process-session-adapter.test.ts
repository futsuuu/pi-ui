import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionContainer } from "./agent-session-container";
import { InProcessSessionAdapter } from "./in-process-session-adapter";
import { SdkSessionRepository } from "./sdk-session-repository";

describe("InProcessSessionAdapter", () => {
  it("keeps the current model when an existing-session selection is unavailable", async () => {
    const prompt = vi.fn(async () => undefined);
    const setModel = vi.fn(async () => undefined);
    const session = {
      model: { provider: "anthropic", id: "current" },
      modelRuntime: { getModel: vi.fn(() => undefined) },
      thinkingLevel: "high",
      prompt,
      setModel,
      setThinkingLevel: vi.fn(),
    } as unknown as AgentSession;
    const container = {
      get: vi.fn(async () => session),
    } as unknown as AgentSessionContainer;
    const adapter = new InProcessSessionAdapter(container, new SdkSessionRepository());

    await adapter.prompt("session-1", {
      text: "hello",
      model: { provider: "anthropic", id: "unavailable" },
      thinkingLevel: "high",
    });

    expect(setModel).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledWith("hello");
  });
});
