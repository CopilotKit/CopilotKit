# Intelligence compatibility runner

Run this tool locally or dispatch it manually through GitHub Actions. The Intelligence monitor can also dispatch `intelligence-compatibility-monitor.yml` with one JSON request. This runner executes native adapter tests against independent installed artifacts. It does not contact Intelligence, Slack, or a paid model.

The six adapters are TypeScript LangGraph, Mastra, the built-in agent, Python LangGraph, Python ADK, and .NET Agent Framework. The built-in agent ships in `@copilotkit/runtime/v2` and watches exact `ai` and `zod` versions. Regular learned-skill CI also runs its installed source consumer against the frozen workspace dependency versions.

## Request

Required fields: `schemaVersion: 1`, UUID `requestId`, one of the six `adapterId` values in `request.mjs`, `track: source | published`, 40-character `sourceSha`, exact `dependencies` for **every** watched framework dependency, and boolean `experimental`. Published requests also require exact `adapterVersion`. Unknown fields, paths, URLs, commands and floating versions are rejected before candidate commands run.

The source SHA fixes fixtures and tests for both source and published tracks. Source tests install packed artifacts; published tests install registry versions. TypeScript requests must include an exact Zod version; the coordinator dispatches Zod 3 and 4 separately. Native tests use local fake models and snapshot responses, including resume, approval, denial, cancellation, streaming and isolation cases where supported by the adapter. Internal TypeScript source-unit suites remain in normal adapter CI; monitor lifecycle tests import the installed public API.

```sh
pnpm nx run compatibility-monitor:test
pnpm nx run compatibility-monitor:run --args="request.json /absolute/path/to/checkout /absolute/path/to/evidence"
```

Install the checkout's frozen pnpm dependencies first. Runners need Node 22.13.0, Python 3.11, uv 0.9.7 and .NET SDK 8/9. The workflow configures them. Package installation and tests run without inherited service credentials or workspace import paths, with a fresh home directory.

## Evidence and conservative outcomes

`result.json` follows the handoff contract. `resolvedDependencies` records watched packages verified in the consumer; `resolvedGraph` additionally records the resolved package graph for comparison across runs (npm keys include install paths). Logs, request, and available lockfiles accompany the artifact. GitHub retains these artifacts for 90 days. The coordinator must compare graphs before attributing failure to the requested upgrade: other dependency changes may explain a difference.

An installation failure, missing test tool, missing loaded-version evidence, or missing executed contract produces `blocked`, never `passed`. Python skipped contracts prevent a green result. A .NET build failure before framework-load evidence remains blocked. Missing registry packages currently produce blocked install evidence; registry discovery in the coordinator handles unpublished adapters.

Experimental requests first try normal dependency resolution, save any rejection, then try test-only resolver overrides. Published package manifests are never rewritten. A forced install does not establish a supported dependency range.

Each request has its own concurrency group. Setup initializes blocked result evidence before installing tools. Artifact upload runs after failed steps. If the runner is cancelled or the artifact cannot be uploaded, the coordinator must classify absent trustworthy results as blocked.

## Deployment order

Merge this workflow and native harness support before enabling coordinator dispatch. GitHub requires a dispatchable workflow on the default branch. Use a pinned source SHA containing this harness support; older checkouts without the monitor options do not establish compatibility and return blocked evidence.

## Manual GitHub run

Save a request as `request.json`, then run:

```sh
gh workflow run intelligence-compatibility-monitor.yml --ref YOUR_COMMIT --raw-field request="$(cat request.json)"
```

Use the same commit for `--ref` and `sourceSha`. For a built-in source request, set `adapterId` to `builtin-ts`, `track` to `source`, and `dependencies` to exact `ai` and `zod` versions. For a published request, also set `adapterVersion` to the exact `@copilotkit/runtime` version. The runtime version must contain the learned-skill public API. The workflow retains test results and installation evidence even when compatibility fails.
