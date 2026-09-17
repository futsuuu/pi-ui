# Session Process Isolation Migration Plan

## Decisions

- Run each live session in its own child process, including sessions that share a working directory.
- Start a worker only when the first prompt is submitted.
- Let the Pi UI server own every worker and stop them during shutdown.
- Assume one Pi UI server process for the current implementation.
- Use Pi's standard RPC protocol only for execution control and live events.
- Keep model and provider management, session discovery, and durable transcript reads on the SDK path in the parent process.
- Do not support providers registered by project extensions in this migration.
- Never replay a prompt automatically after a worker failure.
- Prevent extensions from replacing, forking, or navigating the worker's session.
- Prepare source-neutral boundaries for external IPC and the experimental Pi packages, but do not implement those transports now.

## Phase 0: Fix New-Session Expiration

Complete this behavior fix before any preparatory refactoring.

- Make `GET /session/new` render the first-prompt screen without creating a session.
- Read available models from the singleton `ModelRuntime`.
- Create the current in-process SDK session only when the first prompt is submitted.
- Apply the selected model and thinking level before submitting the prompt.
- Redirect to `/session/:id` once prompt preflight succeeds.
- Dispose of a newly created runtime when prompt startup fails.

Tests must prove that a GET does not create a session, a prompt can be submitted after the page has remained open for more than fifteen minutes, no prompt means no session-list entry, and failed startup leaves no orphan runtime.

## Phase 1: Introduce Application-Owned Contracts

This phase must not change behavior.

Introduce narrow application contracts for:

- durable session lookup, listing, transcript reads, and deletion;
- prompt, steer, follow-up, and abort execution;
- live activity and lifecycle events;
- event-source aggregation and current-turn projection.

Replace direct route, SSE, and React-context dependencies on `AgentSession`, `AgentSessionRuntime`, and `AgentSessionEvent` with application-owned data transfer objects. Keep an in-process adapter around the existing container so runtime creation and UI behavior remain unchanged.

## Phase 2: Split the Session Container

This phase must not change behavior.

Separate the current container into cohesive services:

- an SDK-backed durable session repository;
- an in-process execution adapter;
- a session event hub that owns subscriptions and bounded current-turn projections;
- the existing session view-state repository.

Keep one active record per session containing its runtime, idle timer, execution status, and current-turn projection instead of maintaining independent maps with overlapping lifetimes.

## Phase 3: Move Routes and SSE to the Contracts

This phase must not change behavior beyond the Phase 0 fix.

- Make loaders combine an SDK-backed durable snapshot with the live current-turn projection.
- Make actions depend only on the execution contract.
- Make the SSE route subscribe only to the event hub.
- Send only application-owned event types to the browser.
- Keep browser-to-server SSE connectivity separate from worker lifecycle status.
- Continue using the in-process implementation until the RPC cutover.

## Phase 4: Add the RPC Adapter Without Enabling It

Spawn the public `@earendil-works/pi-coding-agent/rpc-entry` entry point and support only:

- `get_state`;
- `set_model`;
- `set_thinking_level`;
- `prompt`;
- `steer`;
- `follow_up`;
- `abort`.

Do not expose RPC operations for model discovery, transcript or tree reads, session discovery, session replacement, forking, cloning, or durable metadata management.

The adapter must provide strict LF-delimited JSON parsing, runtime validation, a real `get_state` readiness handshake, bounded stderr capture, explicit request and process lifecycle handling, generation-safe exit processing, reconstruction of cumulative partial messages, cancellation responses for extension UI requests, and immutable session identity checks. An application-supplied guard extension must cancel session replacement, forking, and tree navigation.

Pi 0.84.4 exports `RpcClient` from its top-level package. The migration will still use a narrow client around the standard protocol because the provided client uses a fixed startup delay and does not expose the process lifecycle needed by the coordinator.

## Phase 5: Cut Over to Per-Session Workers

### Reads

- Do not start a worker for page views or list requests.
- Read durable metadata and messages with `SessionManager` in the parent.
- Restore model and thinking state from session entries.
- Derive context usage from SDK entries, the parent model catalogue, and any live turn projection.

### First Prompt

- Validate the selected model against the parent SDK catalogue.
- Start an RPC worker with a fixed working directory and selected model.
- For a new session, obtain Pi's generated session ID from the handshake.
- Register event delivery before sending the prompt.
- Redirect to the session URL after prompt acceptance.

### Existing Sessions

- Resolve an absolute session path with the SDK.
- Validate the returned session ID and file during the handshake.
- Coalesce concurrent starts for one session into one promise.
- Serialize model selection, thinking selection, and prompt acceptance per session.

### Retirement and Failure

- Never retire a worker while it is streaming, compacting, or has an unfinished turn.
- Retire an idle worker after fifteen minutes.
- Restart only for a later explicit prompt.
- Retire idle workers after parent-side credential changes and retire running workers after they settle.
- Stop a worker before deleting its session file.
- On unexpected exit, do not replay work; end the transient turn, publish an interruption lifecycle event, and reload the durable SDK snapshot.

## Phase 6: Remove the In-Process Runtime Host

After validating the cutover in a separate change:

- remove parent-process `AgentSession` and `AgentSessionRuntime` ownership;
- remove the in-process execution adapter;
- restrict Pi SDK imports to the durable repository and model services;
- restrict RPC types and parsing to the RPC adapter;
- pin all Pi package versions exactly so protocol changes require an explicit, tested upgrade.

## Future External Sources

Keep observation and command boundaries separate. The local RPC implementation supplies both, while a future external IPC integration may initially supply only activity events. Route source-specific identifiers internally and allow exactly one authoritative live source for a session. Do not expose experimental `serverId` or `attachmentId` values through UI event contracts.

## Completion Criteria

- Read-only operations start no child process.
- Every active session has a distinct process, even when working directories match.
- A worker's session identity never changes.
- The parent retains no `AgentSession` or `AgentSessionRuntime` after cutover.
- Model discovery, authentication, session listing, and durable transcript reads issue no RPC commands.
- Worker failure never replays a prompt or tool operation.
- SSE reconnection restores the durable snapshot and the bounded current turn.
- `pnpm test`, `pnpm lint`, and `pnpm build` pass.
