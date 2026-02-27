# Realtime Threads PoC (v2-only): Redis Locks + Tokenized WS Fanout via Phoenix

## Summary
Build a new `examples/v2/realtime` stack with 3 apps (`client`, `bff`, `gateway`) that exercises this architecture end-to-end:

1. React client uses a new v2 `WebSocketAgent` (in `@copilotkitnext/core`).
2. `WebSocketAgent` calls BFF REST token endpoints (`run-ws`, `connect-ws`), receives opaque token (30s TTL), then exchanges token over one shared WebSocket.
3. BFF runs `BuiltInAgent` through `CopilotRuntime`, enforces Redis thread locks, and publishes AG-UI events to Redis.
4. Phoenix gateway validates token, replays buffered events, then multicasts live thread events to subscribed clients via Channels.
5. Existing SSE runtime behavior remains unchanged (parallel token endpoints only).

## Public API / Interface Changes
1. Add `WebSocketAgent` to `@copilotkitnext/core` exports (PoC-first explicit wiring, no `runtimeTransport` enum change).
2. Add core types:
   1. `WebSocketAgentConfig` with `restUrl`, `wsUrl`, `agentId`, optional `headers`, `credentials`.
   2. Token response contract: `{ token: string; expiresInSeconds: number; threadId: string; wsUrl?: string }`.
3. No changes to `CopilotKitProvider` transport API (`rest | single` stays as-is).
4. No breaking changes to existing runtime endpoints; new BFF-only parallel endpoints:
   1. `POST /agent/:agentId/run-ws`
   2. `POST /agent/:agentId/connect-ws`

## Implementation Plan

## 1) Core package: `WebSocketAgent` (v2 frontend abstraction)
1. Add `WebSocketAgent` near proxied runtime agent in `packages/v2/core/src/agent.ts` or split to dedicated file and re-export from `packages/v2/core/src/index.ts`.
2. `WebSocketAgent` extends `AbstractAgent` and implements:
   1. `run(input)`: POST `run-ws`, receive token, subscribe via shared WS manager, emit parsed `BaseEvent`s.
   2. `connect(input)`: POST `connect-ws`, same token exchange flow.
   3. `abortRun()`: reuse existing stop endpoint semantics (`/stop/:threadId`).
   4. `clone()`: preserves URLs, headers, credentials, agent/thread identity.
3. Add an internal shared WebSocket session manager:
   1. Single socket per `{wsUrl}`.
   2. Token subscription frame: `{ type: "subscribe", token }`.
   3. Route incoming frames to per-token Observables.
   4. Auto-clean token observers on completion/error/timeout.
4. Event frame format consumed by agent: JSON envelope carrying AG-UI event payload; validate with AG-UI schema parse before emitting.

## 2) Realtime example layout (`examples/v2/realtime`)
1. Create a multi-app example layout under `examples/v2/realtime`:
   1. `apps/client` (React/Next client).
   2. `apps/bff` (Express + CopilotRuntime + Redis-backed realtime token endpoints).
   3. `apps/gateway` (Phoenix Channels + Redis pub/sub bridge).
2. Add root orchestration:
   1. docker-compose for Redis + gateway + bff + client.
   2. Nx-runnable scripts/targets (`dev`, `build`, `test`, and per-app variants).

## 3) BFF app behavior (Express + Runtime + Redis)
1. Instantiate `CopilotRuntime` with `BuiltInAgent` and a Redis-aware runner wrapper for lock + publish.
2. Add token endpoints (parallel to existing SSE behavior):
   1. `run-ws`:
      1. Validate body as `RunAgentInput`.
      2. Enforce Redis thread lock; if locked return `409` with structured `thread_locked` error.
      3. Mint opaque token (TTL 30s), persist token metadata in Redis.
      4. Start run asynchronously; publish each AG-UI event to Redis thread channel and token replay buffer.
      5. Return token JSON immediately.
   2. `connect-ws`:
      1. Validate body.
      2. Mint opaque token (TTL 30s).
      3. Produce replay payload from runner `connect`/stored thread events, store in token replay buffer.
      4. Return token JSON.
3. Thread lock strategy:
   1. Redis lock key per thread.
   2. Acquire before run; release on finalize/error/stop.
   3. Stop endpoint keeps current semantics and clears lock safely.
4. Redis keys/channels (fixed naming contract):
   1. `ck:token:{token}` metadata (30s TTL, one-time use).
   2. `ck:token-replay:{token}` buffered events (30s TTL).
   3. `ck:thread:{threadId}:events` compacted durable thread history (for reconnect support).
   4. `ck:thread:{threadId}:pubsub` live fanout channel.

## 4) Phoenix gateway (real Elixir app, minimal channels implementation)
1. Build a real Phoenix app with one socket + channel namespace for realtime agent streams.
2. WS protocol:
   1. Client sends subscribe event with opaque token.
   2. Gateway atomically consumes token (`GETDEL`-equivalent pattern), rejects expired/used tokens.
   3. Gateway sends replay events from `ck:token-replay:{token}` first.
   4. Gateway subscribes client process to `ck:thread:{threadId}:pubsub` and broadcasts live AG-UI events.
3. Multicast behavior:
   1. Multiple clients can subscribe to same thread and receive live events.
   2. Replay remains token-scoped to avoid replay duplication to existing viewers.
4. Keep Phoenix scope minimal: Channels, Redis bridge, token validation, thread broadcast; no extra production auth/metrics layers.

## 5) Client app (React + CopilotKit v2)
1. Use `CopilotKitProvider` with explicit `selfManagedAgents` (or `agents__unsafe_dev_only`) and instantiate `WebSocketAgent` directly.
2. Use `CopilotChat` with selectable `threadId` to demonstrate:
   1. Initial connect replay.
   2. Live streamed run events over shared WS.
   3. Multicast behavior across multiple browser tabs/clients.
3. Show lock behavior explicitly:
   1. Attempt concurrent run on same thread.
   2. Display `409 thread_locked` user-visible state.
4. Keep all imports in v2 namespace only (`@copilotkitnext/*`).

## 6) Validation, tests, and acceptance criteria
1. Core tests (`@copilotkitnext/core`):
   1. `WebSocketAgent.run/connect` token flow.
   2. Shared socket multiplexing across multiple agent instances.
   3. `clone()` correctness.
   4. `abortRun()` stop call behavior.
2. BFF tests:
   1. `run-ws` returns token and triggers publish.
   2. `connect-ws` returns token + replay buffer.
   3. Lock conflict returns `409`.
   4. Token TTL and one-time use semantics.
3. Gateway tests (ExUnit):
   1. Valid token subscription succeeds.
   2. Expired/reused token rejected.
   3. Replay precedes live events.
   4. Multi-client thread multicast works.
4. End-to-end smoke:
   1. Start compose stack.
   2. Connect client A and B to same thread.
   3. Run once from A; both receive stream.
   4. Concurrent second run returns `409`.
5. Nx verification commands included in docs/scripts for all affected projects.

## Assumptions and Defaults
1. This is a strawman PoC with first-class behavior in example apps and `WebSocketAgent` in core, not a full runtime transport-mode rollout.
2. Existing SSE (`run/connect`) remains source-compatible and untouched.
3. Opaque tokens are short-lived (30s), one-time consumed, and carry no readable client semantics.
4. Redis is the lock and event bus for PoC; Postgres/OpenSearch remain out of scope.
5. Phoenix implementation is real but minimal, focused only on token-authenticated Channels fanout.
6. No v1 package changes.
