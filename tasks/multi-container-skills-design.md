# Multiple containers for learned skill delivery

The user approved the interface on 2026-09-23. This changes skill consumption, not thread membership.

## SDK contract

Keep the existing `containerId` and top-level `revision` interface and environment defaults unchanged.
Add `containers: [{ id: "support", revision: "revision-123" }, { id: "company-wide" }]`.
Reject explicit new and old fields together. TypeScript enforces this through an exclusive union, and every language validates at runtime.
The new interface ignores legacy container/revision environment variables. Credentials, timeouts, and refresh configuration remain shared.
Require a nonempty list with unique nonempty IDs and nonempty revision pins when supplied. Copy caller-owned configuration.
Use idiomatic Python and .NET equivalents.

## Delivery behavior

Reuse the existing verified per-container fetch and cache. Fetch selected containers concurrently and capture all results before model or tool work.
Each container keeps its own revision, ETag, freshness, denial state, and transient-error fallback. Never reuse an aggregate cache to bypass a denial.
A cold or denied container fails the invocation; do not silently provide a partial catalog. Other warm containers can use their existing transient-error fallback.
In the new interface, qualify every skill name as `<URI-encoded-container-id>/<skill-name>` so tool identifiers stay stable as other containers change.
Keep old single-container skill names unchanged. Tool reads always target the invocation's captured snapshot.
Expose per-container status in new mode without changing old status fields or behavior. Composite internal snapshot identities are local identities, not server revision pins.

## Surfaces

TypeScript common registry, BuiltInAgent, Mastra, LangGraph TypeScript, Python common delivery core with LangGraph and ADK adapters, and .NET Agent Framework.
The CLI accepts several positional container IDs. One container retains the old flat output. Several containers use `<output>/<container-id>/` and publish the whole destination atomically only after every bundle validates.
Update package READMEs, product docs, CLI help and onboarding references where applicable. No server endpoint or database changes.

## Validation

Test legacy configuration and environment behavior; mixed-interface rejection; duplicate/empty selections; per-container pins and ETags; colliding names and file reads; invocation isolation; partial failure; denial after cached success; concurrent callers and cancellation.
Test CLI argument collection, single-container compatibility, scoped directories, validation failure cleanup, and output collision protection.
Run focused tests, type checks and affected builds through existing Nx targets. Record unavailable or pre-existing checks precisely.
