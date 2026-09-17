# Intelligence compatibility runner

The Intelligence monitor dispatches `intelligence-compatibility-monitor.yml` with one JSON request. This runner executes native adapter tests against independent installed artifacts. It does not contact Intelligence, Slack, or a paid model.

## Request

Required fields: `schemaVersion: 1`, UUID `requestId`, one of the five `adapterId` values in `request.mjs`, `track: source | published`, 40-character `sourceSha`, exact `dependencies` for **every** watched framework dependency, and boolean `experimental`. Published requests also require exact `adapterVersion`. Unknown fields, paths, URLs, commands and floating versions are rejected before candidate commands run.

The source SHA fixes fixtures and tests for both source and published tracks. Source tests install packed artifacts; published tests install registry versions. The two TypeScript Zod lanes use 3.25.76 and 4.6.1. Native tests use local fake models and snapshot responses, including resume, approval, denial, cancellation, streaming and isolation cases where supported by the adapter. Internal TypeScript source-unit suites remain in normal adapter CI; monitor lifecycle tests import the installed public API.

```sh
pnpm nx run compatibility-monitor:test
pnpm nx run compatibility-monitor:run --args="request.json /absolute/path/to/checkout /absolute/path/to/evidence"
```

Install the checkout's frozen pnpm dependencies first. Runners need Node 22.13.0, Python 3.11, uv 0.9.7 and .NET SDK 8/9. The workflow configures them. Package installation and tests run without inherited service credentials or workspace import paths, with a fresh home directory.

## Evidence and conservative outcomes

`result.json` follows the handoff contract. `resolvedDependencies` records watched packages verified in the consumer; `resolvedGraph` additionally records the resolved package graph for comparison across runs (npm keys include Zod lane and install path). Logs, request, and available lockfiles accompany the artifact. The coordinator must compare graphs before attributing failure to the requested upgrade: other dependency changes may explain a difference.

An installation failure, missing test tool, missing loaded-version evidence, or missing executed contract produces `blocked`, never `passed`. Python skipped contracts prevent a green result. A .NET build failure before framework-load evidence remains blocked. Missing registry packages currently produce blocked install evidence; registry discovery in the coordinator handles unpublished adapters.

Experimental requests first try normal dependency resolution, save any rejection, then try test-only resolver overrides. Published package manifests are never rewritten. A forced install does not establish a supported dependency range.

Each request has its own concurrency group. Setup initializes blocked result evidence before installing tools. Artifact upload runs after failed steps. If the runner is cancelled or the artifact cannot be uploaded, the coordinator must classify absent trustworthy results as blocked.

## Deployment order

Merge this workflow and native harness support before enabling coordinator dispatch. GitHub requires a dispatchable workflow on the default branch. Use a pinned source SHA containing this harness support; older checkouts without the monitor options do not establish compatibility and return blocked evidence.
