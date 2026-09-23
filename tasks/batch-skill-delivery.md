# Batch skill delivery plan

User approved one batch request for the new containers interface, with the existing single-container endpoint unchanged.

## Contract

POST `/api/v1/learning/skills/batch` with JSON `{ "containers": [{ "containerId": "support", "revision": "42", "ifNoneMatch": "etag" }] }`. Revision and ifNoneMatch are optional. Require 1–50 unique container IDs. Reject malformed IDs, blank revisions, and invalid ETags. The project key scopes every read. Authenticate and resolve entitlement before all reads.

HTTP 200 JSON `{ "containers": [...] }` returns one result per requested ID in request order. Snapshot entry: `{ "containerId": "support", "status": "snapshot", "revision": "42", "etag": "...", "contentType": "application/zip", "bytesBase64": "..." }`. Unchanged entry has status unchanged, revision and etag, no bytes. Error entry: `{ "containerId": "support", "status": "error", "error": { "code": "REVISION_REVOKED", "retryable": false } }`, using existing public SDK error codes. Request-wide authentication, entitlement, validation and availability failures retain existing HTTP error envelopes. Never expose internal exception details.

Clients strictly validate response IDs, uniqueness, completeness, metadata and base64. Malformed envelopes fail closed. Multi-container registries send one batch for the sources requiring refresh, preserving per-source caches, errors, denial, timeouts and immutable snapshots. No fallback to separate HTTP requests. Legacy single-source configuration keeps its old request. One explicit containers entry still uses batch. Server must deploy before new SDK configuration is used. CLI multi-container downloads use a separate product-authenticated POST `/api/learning/projects/:projectId/skills/batch` body `{containers:[{containerId}]}` and response `{containers:[{containerId,bytesBase64,etag,contentType}]}`. All product bundles must succeed or the response fails. Single CLI downloads retain the old endpoint and flat layout.

## Tasks

- [ ] Server: failing route/auth tests, bounded parallel reads, batch response, errors/docs, focused test/lint/typecheck/build.
- [ ] TypeScript: failing transport and registry request-count tests, batch client and exports, registry batching, native adapter fixtures, focused tests/build/types.
- [ ] Python: canonical batch client plus registry, request-count/cache/error tests, native adapters and distribution checks.
- [ ] .NET: canonical batch client plus registry, request-count/cache/error tests, build and standalone package tests.
- [ ] CLI: add product batch route and API, preserve single behavior and atomic directory installation, test request count and failures.
- [ ] Docs and review: document wire behavior and rollout; specification then quality review; final validation; commits and update existing draft PRs.
