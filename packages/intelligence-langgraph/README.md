# CopilotKit Intelligence for LangGraph

Native LangGraph middleware that injects only fully verified CopilotKit Intelligence Registry skills into model calls.

## Installation

Install `@copilotkit/intelligence-langgraph@0.1.0` on Node.js 20 or newer. It supports `@copilotkit/intelligence>=0.1.0 <1.0.0`, `@langchain/langgraph>=1.3.0 <2.0.0`, and `langchain>=1.4.4 <2.0.0`.

```sh
pnpm add @copilotkit/intelligence-langgraph @copilotkit/intelligence @langchain/langgraph langchain
```

## Native registration

Register the returned native middleware directly with LangChain's public `createAgent({ middleware: [...] })` API. The adapter never constructs or wraps an agent.

```ts
import { IntelligenceClient } from "@copilotkit/intelligence";
import { createSkillRegistryMiddleware } from "@copilotkit/intelligence-langgraph";
import { createAgent } from "langchain";

const client = new IntelligenceClient({
  baseUrl: "https://api.example.com",
  accessToken: process.env.COPILOTKIT_TOKEN!,
  projectNamespace: "example",
  cacheRoot: ".copilotkit/intelligence",
});
const skills = createSkillRegistryMiddleware({
  client,
  learningContainerId: "55555555-5555-4555-8555-555555555555",
});
const agent = createAgent({
  model: "openai:gpt-5.4-mini",
  tools: [],
  middleware: [skills],
});
```

## Lifecycle and preload

`await skills.preload()` performs a fresh networked Registry load. `await skills.preloadCached()` is the only explicit offline entry point. Native model calls use `await skills.load()`. Inspect `skills.ready`, `skills.status`, and `skills.snapshot`, or await `skills.waitUntilReady({ timeoutMs })`. A cold model call blocks and fails closed until a complete verified snapshot exists.

## Fresh and cached data

Fresh and cached sources remain visible in every snapshot. Request-time loads use a 30-second refresh interval, concurrent callers share one promise, and refresh attempts start the throttle window even when they fail. A stale snapshot is retained only for diagnostics: there is no implicit stale fallback and stale skill text is never injected.

## Limits and scripts

The adapter accepts at most 128 skills, 262144 UTF-8 bytes per root `SKILL.md`, and 1048576 UTF-8 bytes across the complete set. Decoding is strict UTF-8. Any limit violation fails the full set without truncation or reordering. A manifest `script` role or normalized path under `scripts/` denies the full load; artifact content is never executed.

## Telemetry

An optional sink receives `load.started`, `load.throttled`, `load.singleflight_joined`, `load.succeeded`, `load.failed`, and `status.changed`. Permitted fields are framework and adapter version, source/freshness/status, skill count, latency, Registry revision, joined count, and canonical error code/category/retryability/request ID/trace ID. Events never include access tokens, project namespace, learning-container ID, skill text, paths, or bundle content. Sink failures are explicit; joined callers receive the same exception.

## Errors

Canonical auth, permission, HTTP 401/403/404/410, archived-container, project-mismatch, container-not-found, and unrecoverable Registry errors deny the adapter. Transient or integrity refresh failures become stale and fail closed. Adapter validation uses `INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS`, `INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE`, `INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE`, `INTELLIGENCE_ADAPTER_INVALID_UTF8`, and `INTELLIGENCE_ADAPTER_SCRIPT_DISABLED`.

## Closing

`await skills.close()` is idempotent. An already-running model invocation keeps its captured immutable snapshot, while every load created after closing rejects with `LEARNING_REGISTRY_CLOSED`.

## Compatibility

The supported exclusive-major ranges are `@copilotkit/intelligence>=0.1.0 <1.0.0`, `@langchain/langgraph>=1.3.0 <2.0.0`, and `langchain>=1.4.4 <2.0.0`. The public `createMiddleware`/`wrapModelCall` hook and immutable `systemMessage.concat` request-copy path are verified at the exact minimum pair (`@langchain/langgraph@1.3.0`, `langchain@1.4.4`) and newest compatible releases.

## Ownership and release

Intelligence/Learning owns this independently versioned package. It uses its own `intelligence-langgraph/vX.Y.Z` tag and npm publish lane; no adapter release waits for or forces another adapter package release.
