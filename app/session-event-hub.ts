export class SessionEventProjection<Event, Projection> {
  private value: Projection | undefined;

  constructor(
    private readonly reducer: (
      value: Projection | undefined,
      event: Event,
    ) => Projection | undefined,
  ) {}

  get current(): Projection | undefined {
    return this.value;
  }

  update(event: Event): void {
    this.value = this.reducer(this.value, event);
  }

  clear(): void {
    this.value = undefined;
  }
}

export class SessionEventHub<Event> {
  private readonly listeners = new Set<(sessionId: string, event: Event) => void>();

  createProjection<ProjectedEvent, Projection>(
    reducer: (value: Projection | undefined, event: ProjectedEvent) => Projection | undefined,
  ): SessionEventProjection<ProjectedEvent, Projection> {
    return new SessionEventProjection(reducer);
  }

  subscribe(listener: (sessionId: string, event: Event) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(sessionId: string, event: Event): void {
    for (const listener of this.listeners) {
      try {
        listener(sessionId, event);
      } catch {}
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
