export interface SessionViewState {
  sessionId: string;
  lastDisplayedMessageKey: string | null;
}

/**
 * Derived read state for one session, computed from the stored cursor and
 * the session's current renderable-message projection (never persisted).
 */
export interface SessionReadState {
  lastDisplayedMessageKey: string | null;
  latestMessageKey: string | null;
  isRead: boolean;
}

export class SessionViewStateRepository {
  private states = new Map<string, SessionViewState>();

  public get(sessionId: string): SessionViewState | null {
    return this.states.get(sessionId) ?? null;
  }

  /**
   * Store the cursor for a session (the caller enforces monotonicity). A
   * `null` cursor creates an unread marker: the session has a record but no
   * message was displayed yet, so it counts as unread.
   */
  public set(sessionId: string, lastDisplayedMessageKey: string | null): SessionViewState {
    const state: SessionViewState = { sessionId, lastDisplayedMessageKey };
    this.states.set(sessionId, state);
    return state;
  }

  public delete(sessionId: string): void {
    this.states.delete(sessionId);
  }

  public entries(): SessionViewState[] {
    return [...this.states.values()];
  }
}
