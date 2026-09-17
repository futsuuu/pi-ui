import type { AgentSession } from "@earendil-works/pi-coding-agent";

import {
  mergedSessionMessages,
  type AgentSessionContainer,
  type ContainerEvent,
} from "./agent-session-container";
import { toSessionActivityEvent } from "./pi-session-event-adapter";
import type {
  SessionActivitySource,
  SessionDeleteHints,
  SessionEvent,
  SessionEventHub,
  SessionExecutor,
  SessionLookupHints,
  SessionPromptInput,
  SessionRepository,
  SessionSnapshot,
} from "./session-contracts";

function snapshotOf(session: AgentSession): SessionSnapshot {
  return {
    id: session.sessionId,
    cwd: session.sessionManager.getCwd(),
    messages: mergedSessionMessages(session),
    state: {
      model: session.model
        ? {
            name: session.model.name,
            provider: session.model.provider,
            id: session.model.id,
          }
        : null,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      contextUsage: session.getContextUsage() ?? null,
    },
  };
}

async function configureSession(session: AgentSession, input: SessionPromptInput): Promise<void> {
  if (session.model?.provider !== input.model.provider || session.model.id !== input.model.id) {
    const model = session.modelRuntime.getModel(input.model.provider, input.model.id);
    if (!model) {
      throw new Error(
        `Model ${JSON.stringify(`${input.model.provider}/${input.model.id}`)} not found`,
      );
    }
    await session.setModel(model);
  }
  if (session.thinkingLevel !== input.thinkingLevel) {
    session.setThinkingLevel(input.thinkingLevel);
  }
}

async function waitForPromptStart(session: AgentSession, text: string): Promise<void> {
  let resolveStart!: () => void;
  let rejectStart!: (error: unknown) => void;
  const started = new Promise<void>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });
  const completion = session.prompt(text, {
    preflightResult: (accepted) => {
      if (accepted) resolveStart();
      else rejectStart(new Error("Prompt was rejected before starting"));
    },
  });
  void completion.then(
    () => rejectStart(new Error("Prompt completed before starting")),
    rejectStart,
  );
  await started;
}

function applicationEvent(event: ContainerEvent): SessionEvent {
  if (event.type === "session_deleted" || event.type === "view_state") return event;
  return toSessionActivityEvent(event);
}

export class InProcessSessionAdapter
  implements SessionRepository, SessionExecutor, SessionActivitySource, SessionEventHub
{
  constructor(private readonly container: AgentSessionContainer) {}

  listInfo(dir: string) {
    return this.container.listInfo(dir);
  }

  findSessionCwd(sessionId: string) {
    return this.container.findSessionCwd(sessionId);
  }

  async read(sessionId: string, hints: SessionLookupHints = {}): Promise<SessionSnapshot | null> {
    const session = await this.container.get(sessionId, hints);
    return session ? snapshotOf(session) : null;
  }

  delete(sessionId: string, hints: SessionDeleteHints) {
    return this.container.delete(sessionId, hints);
  }

  async start(cwd: string, input: SessionPromptInput): Promise<{ id: string }> {
    const session = await this.container.create(cwd);
    let started = false;
    try {
      await configureSession(session, input);
      await waitForPromptStart(session, input.text);
      started = true;
      return { id: session.sessionId };
    } finally {
      if (!started) await this.container.dispose(session.sessionId);
    }
  }

  async ensure(sessionId: string, hints: SessionLookupHints = {}): Promise<boolean> {
    return (await this.container.get(sessionId, hints)) !== null;
  }

  async snapshot(sessionId: string): Promise<SessionSnapshot | null> {
    const session = await this.container.get(sessionId);
    return session ? snapshotOf(session) : null;
  }

  async prompt(sessionId: string, input: SessionPromptInput): Promise<void> {
    const session = await this.requiredSession(sessionId);
    await configureSession(session, input);
    await session.prompt(input.text);
  }

  async steer(sessionId: string, input: SessionPromptInput): Promise<void> {
    const session = await this.requiredSession(sessionId);
    await configureSession(session, input);
    await session.steer(input.text);
  }

  async followUp(sessionId: string, input: SessionPromptInput): Promise<void> {
    const session = await this.requiredSession(sessionId);
    await configureSession(session, input);
    await session.followUp(input.text);
  }

  async abort(sessionId: string): Promise<void> {
    const session = await this.requiredSession(sessionId);
    await session.abort();
  }

  dispose(sessionId: string) {
    return this.container.dispose(sessionId);
  }

  disposeAll() {
    return this.container.disposeAll();
  }

  currentInfoList() {
    return this.container.currentInfoList();
  }

  currentInfo(sessionId: string) {
    return this.container.currentInfo(sessionId);
  }

  getTurnEvents(sessionId: string) {
    return this.container.getTurnEvents(sessionId).map(toSessionActivityEvent);
  }

  getSessionReadState(sessionId: string, hints: SessionLookupHints = {}) {
    return this.container.getSessionReadState(sessionId, hints);
  }

  markMessageDisplayed(sessionId: string, messageKey: string, hints: SessionLookupHints = {}) {
    return this.container.markMessageDisplayed(sessionId, messageKey, hints);
  }

  subscribe(listener: (sessionId: string, event: SessionEvent) => void): () => void {
    return this.container.subscribe((sessionId, event) =>
      listener(sessionId, applicationEvent(event)),
    );
  }

  private async requiredSession(sessionId: string): Promise<AgentSession> {
    const session = await this.container.get(sessionId);
    if (!session) throw new Error(`Session ${JSON.stringify(sessionId)} not found`);
    return session;
  }
}
