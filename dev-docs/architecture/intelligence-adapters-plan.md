# Intelligence Registry Framework Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five independently versioned framework-native adapters that make verified CopilotKit Intelligence Registry skills available to Google ADK, LangGraph Python, LangGraph TypeScript, Microsoft Agent Framework Python, and Microsoft Agent Framework .NET without adding another Registry HTTP client.

**Architecture:** Every adapter receives the existing generic-language Registry client, converts only a completely verified `InstalledSkillSet` into one immutable framework snapshot, and swaps that snapshot atomically. A shared, versioned JSON corpus specifies lifecycle and security behavior, while each independently released package owns a small language-native runner for that corpus and has no runtime dependency on another adapter package.

**Tech Stack:** Python 3.10+ with Poetry and pytest; Node.js 20+ with TypeScript, Vitest, Nx, publint, and Are the Types Wrong; .NET 8 with xUnit and NuGet; GitHub Actions OIDC/trusted publishing; the existing `copilotkit`, `@copilotkit/intelligence`, and `CopilotKit.Intelligence` Registry SDKs.

---

## Decisions and non-goals

These decisions are inputs to implementation and are not reopened by an adapter slot:

| Artifact | Public surface | Framework support | Runtime SDK dependency |
| --- | --- | --- | --- |
| PyPI `copilotkit-intelligence-adk` | `SkillRegistry`, `SkillToolset` | `google-adk>=2.0.0,<3.0.0`; Python >=3.10 | `copilotkit>=0.1.94,<1.0.0` |
| PyPI `copilotkit-intelligence-langgraph` | `create_skill_registry_middleware` | `langgraph>=1.2.2,<2.0.0`, `langchain>=1.3.2,<2.0.0`; Python >=3.10 | `copilotkit>=0.1.94,<1.0.0` |
| npm `@copilotkit/intelligence-langgraph` | `createSkillRegistryMiddleware` | `@langchain/langgraph>=1.3.0 <2.0.0`, `langchain>=1.4.3 <2.0.0`; Node >=20 | peer `@copilotkit/intelligence>=0.1.0 <1.0.0` |
| PyPI `copilotkit-intelligence-agent-framework` | `SkillRegistryContextProvider` | `agent-framework-core>=1.11.0,<2.0.0`; Python >=3.10 | `copilotkit>=0.1.94,<1.0.0` |
| NuGet `CopilotKit.Intelligence.AgentFramework` | `SkillRegistryContextProvider` | `Microsoft.Agents.AI.Abstractions` `[1.13.0,2.0.0)`; `net8.0` | `CopilotKit.Intelligence` `[0.1.0,1.0.0)` |

The normative cross-language symbol is `createSkillRegistryMiddleware`. Python exports the idiomatic `create_skill_registry_middleware`; its README, docstring, and API test must say that it is the Python spelling of the normative symbol.

All five packages are owned by Intelligence/Learning, are versioned and published independently, and must not be added to the shared-version monorepo scope. They adapt framework extension points; they do not construct, wrap, or own an agent. Existing generic SDK names and APIs remain unchanged.

## Repository layout and file ownership

The implementation creates the following roots. A parallel slot owns exactly one row; it must not edit another row or any serialized file listed later.

| Slot | Exclusive root | Package artifacts |
| --- | --- | --- |
| `adk-python` | `sdk-python-adk/**` | sdist and universal wheel for `copilotkit-intelligence-adk` |
| `langgraph-python` | `sdk-python-langgraph/**` | sdist and universal wheel for `copilotkit-intelligence-langgraph` |
| `langgraph-typescript` | `packages/intelligence-langgraph/**` | ESM npm tarball for `@copilotkit/intelligence-langgraph` |
| `agent-framework-python` | `sdk-python-agent-framework/**` | sdist and universal wheel for `copilotkit-intelligence-agent-framework` |
| `agent-framework-dotnet` | `sdk-dotnet-agent-framework/**` | `.nupkg` and `.snupkg` for `CopilotKit.Intelligence.AgentFramework` |

Shared files are serialized after those five slots:

- `packages/intelligence/conformance/registry-adapters-v1.json`
- `packages/intelligence/scripts/verify-adapter-corpus.ts`
- `packages/intelligence/src/adapter-conformance.test.ts`
- `release.config.json`
- `.github/CODEOWNERS`
- `.github/workflows/test-intelligence-adapters.yml`
- `.github/workflows/publish-release.yml`
- `scripts/release/detect-intelligence-adapter-version-changes.ts`
- `scripts/release/lib/config.test.ts`
- `scripts/release/lib/versions.test.ts`
- `pnpm-lock.yaml`

The serialized owner records `Intelligence/Learning` in workflow summaries and package metadata. Before changing `.github/CODEOWNERS`, the release slot obtains the repository team slug with `gh api orgs/CopilotKit/teams --paginate --jq '.[] | select(.name == "Intelligence/Learning") | .slug'`; the command must return exactly one line. It then writes `@CopilotKit/<returned-slug>` for all five roots. Zero or multiple results is a blocking repository-configuration error, not a reason to invent a handle.

## Common lifecycle contract

Each public adapter exposes the same behavior through language-appropriate names. Its internal state is one immutable record:

```text
AdapterSnapshot = {
  status: cold | loading | ready | refreshing | stale | denied | revoked | closed,
  source: fresh | cached | none,
  installedSkillSet: verified generic-SDK result or none,
  frameworkValue: fully constructed native value or none,
  lastAttemptAt: monotonic time or none,
  lastSuccessAt: monotonic time or none,
  error: canonical SDK error or none
}
```

The lifecycle surface is exact even though each native hook signature is gated on dependency inspection:

| Runtime | Fresh | Explicit offline | Request-time | Readiness/status | Close |
| --- | --- | --- | --- | --- | --- |
| Python | `await preload()` | `await preload_cached()` | `await load()` | `ready`, `status`, `await wait_until_ready(timeout)` | `await aclose()` |
| TypeScript | `await preload()` | `await preloadCached()` | `await load()` | `ready`, `status`, `await waitUntilReady({ timeoutMs })` | `await close()` |
| .NET | `PreloadAsync` | `PreloadCachedAsync` | `LoadAsync` | `IsReady`, `Status`, `WaitUntilReadyAsync` | `DisposeAsync` |

The ADK methods live on `SkillRegistry`; the other packages expose them on the native middleware/provider object returned or constructed by the required public symbol. `ready`/`IsReady` is true only for `ready` and `revoked`. A readiness wait returns the immutable snapshot, rejects immediately for `denied`, `stale`, or `closed`, and times out without changing state.

`preload()` always calls the generic SDK's networked `get`/`GetAsync` and awaits a complete framework snapshot. `preload_cached()`/`preloadCached()` is the only offline entry point and calls the generic SDK's explicit cached method. `load()` is the request-time operation used by the native hook: it returns the current snapshot while it is within `refresh_interval` (default 30 seconds); after that interval it awaits a networked refresh. Calls for the same registry instance and container share one in-flight future/task/promise. The throttle timestamp is the start of the last attempted network load, so a failing endpoint cannot be hammered on every model call.

Cold start is fail-closed: the first native hook blocks for `load()` and the framework model/tool execution does not begin until a verified snapshot exists. A transient or integrity failure after the refresh interval changes `ready` to `stale`, retains the last-good immutable value for diagnostics, and refuses to inject or return it. The next call after the throttle window retries. There is no implicit stale fallback. An explicit successful cached preload is marked `source=cached`, is ready only for that process lifetime, and is reported as such in status and telemetry.

Canonical authentication, permission, not-found, archive, project-mismatch, HTTP 401/403/404/410, and `LEARNING_REGISTRY_UNRECOVERABLE` failures atomically clear the active framework value and change status to `denied`. A successful revoked projection swaps in an authorized empty value and changes status to `revoked`; `revoked` is ready but provides no skill context or tools. A successful empty non-revoked projection is `ready` with an empty value. Closing disposes native resources, cancels no already-running model invocation, rejects future loads, and is idempotent.

Disk atomicity and verification remain entirely owned by the generic SDK. Adapter code never reads a pointer file, downloads a bundle, validates a hash, or reimplements HTTP. It receives ordered installed directories, reads only the verified root `SKILL.md` files with strict UTF-8, builds the complete native value off to the side, and performs one in-memory pointer swap under a lock. An in-flight invocation captures one snapshot and therefore cannot observe a mixed revision.

Adapter rendering adds narrower prompt-safety limits on top of generic archive limits:

- at most 128 skills;
- at most 262,144 UTF-8 bytes in one `SKILL.md`;
- at most 1,048,576 UTF-8 bytes across the rendered set;
- no truncation, replacement decoding, partial set, or reordering;
- files with manifest role `script` or a normalized path under `scripts/` make the complete adapter load fail with `INTELLIGENCE_ADAPTER_SCRIPT_DISABLED`;
- adapters never spawn a process, add a shell/code-execution tool, or execute artifact content.

The other adapter validation codes are `INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS`, `INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE`, `INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE`, and `INTELLIGENCE_ADAPTER_INVALID_UTF8`. They are adapter-local error codes with the original generic SDK exception retained as `cause`/`InnerException`; they are not added to the Learning Platform wire-error enum.

Framework values use projection order and include skill ID, version ID, name, nullable description, and exact `SKILL.md` text. The framework hook may use its native skill, middleware, toolset, or context object, but the rendered semantic value must match the corpus byte-for-byte. The ADK `SkillToolset` delegates discovery/materialization to `SkillRegistry`; it never owns Registry networking. LangGraph factories return native middleware objects. Agent Framework providers return native context and never subclass/delegate an agent.

Telemetry is an optional injected callback/sink; adapters do not add an observability dependency. Emit `load.started`, `load.throttled`, `load.singleflight_joined`, `load.succeeded`, `load.failed`, and `status.changed` with framework name, adapter version, fresh/cached source, status, skill count, refresh latency, registry revision, and canonical error code/category/retryability/request ID/trace ID when present. Never include access tokens, project namespace, learning-container ID, skill text, paths, or bundle contents. Telemetry callback failure is explicit and fails the initiating adapter operation; joined callers observe the same failure.

## Native API verification gates

The repository locks or demonstrates older framework APIs, but does not contain installed source for `google-adk` 2.0, `langgraph` 1.2.2/`langchain` 1.3.2, `langchain` TypeScript 1.4.3, `agent-framework-core` 1.11.0, or `Microsoft.Agents.AI.Abstractions` 1.13.0. Exact inheritance names and callback signatures must therefore be discovered, compiled, and recorded before production implementation rather than guessed in this plan.

Each adapter slot first creates `tests/api_contract/` probes at both the exact minimum and the newest version below the next major. A probe prints the package version and native base/interface signature, then compiles or imports a minimal no-op extension registered through the same public constructor/API an application will use. The resulting checked-in `README.md` compatibility section names the verified native hook. Production work cannot start until both probes pass; if the minimum lacks the required native extension point, the slot reports that dependency-boundary conflict instead of substituting an agent wrapper.

## Shared adapter conformance corpus

`registry-adapters-v1.json` is test data, not a published runtime package. It extends the existing Registry golden identity with deterministic fake-clock scenarios for cold fresh load, explicit cached preload, throttle hit, concurrent singleflight, ETag-driven unchanged refresh, changed revision, empty set, revoked set, transient failure, integrity failure, denial, over-count, per-file/aggregate size overflow, invalid UTF-8, script-role denial, and close. Every case declares ordered input operations, generic-client calls, expected status transitions, whether a native hook may proceed, telemetry event names, and the exact rendered skill records.

Each adapter includes a small test-only runner that consumes this JSON directly from `../packages/intelligence/conformance/` (with the correct relative depth for its root). The corpus has its own `schemaVersion` and `contractVersion`; adapter package versions never appear in it, and released packages do not contain or depend on the corpus. Thus a corpus change requires all five repository test runners to pass but does not force five releases. `verify-adapter-corpus.ts` validates uniqueness, transition completeness, byte counts, and coverage of every required scenario.

## Compatibility and release policy

PR CI has ten framework jobs: minimum and newest-compatible for each package. Minimum jobs install the exact lower bounds above. Newest jobs resolve the declared exclusive-major ranges without a lock override, print the resolved dependency tree, and archive it with test results. Python jobs run on 3.10; an additional packaging smoke job imports each wheel on the repository's normal Python matrix. TypeScript runs on Node 20 and the repository current Node. .NET runs `net8.0` and resolves the minimum and newest allowed NuGet versions through generated `Directory.Packages.props` files.

The standard npm release machinery gains a non-shared `intelligence-langgraph` scope whose only package and version source are `@copilotkit/intelligence-langgraph`. The existing `publish-release.yml` receives three separately detected PyPI adapter jobs and one separately detected NuGet adapter job; each key is package identity plus version, each publishes only when that package's own manifest version changed, and no adapter waits for another adapter. Build jobs have no publish credential, PyPI uses OIDC trusted publishing, npm retains its existing OIDC lane, and NuGet receives its API key only in the final push step. Tags are `intelligence-adk-python/vX.Y.Z`, `intelligence-langgraph-python/vX.Y.Z`, `intelligence-langgraph/vX.Y.Z`, `intelligence-agent-framework-python/vX.Y.Z`, and `intelligence-agent-framework-dotnet/vX.Y.Z`.

Release acceptance requires inspecting wheel/sdist contents, npm tarball contents plus publint/ATTW, and NuGet `.nuspec` plus symbols. Every artifact must contain README/license/repository metadata, only its own public package, and bounded runtime dependencies. The release detector treats an already-published identical version as an idempotent success and any registry/auth/network ambiguity as a hard failure.

## Task 1: Create and validate the shared corpus

**Files:**

- Create: `packages/intelligence/conformance/registry-adapters-v1.json`
- Create: `packages/intelligence/scripts/verify-adapter-corpus.ts`
- Create: `packages/intelligence/src/adapter-conformance.test.ts`
- Modify: `packages/intelligence/package.json`

- [ ] **Step 1: Write the failing corpus contract test**

Add a test that loads the JSON, requires `schemaVersion: 1`, `contractVersion: "registry-adapters-v1"`, rejects duplicate case names, and asserts this exact scenario set:

```ts
expect(new Set(corpus.cases.map(({ name }) => name))).toEqual(
  new Set([
    "cold-fresh-load", "explicit-cached-preload", "throttle-hit",
    "concurrent-singleflight", "etag-unchanged", "changed-revision",
    "empty", "revoked", "transient-stale", "integrity-stale", "denial",
    "too-many-skills", "skill-md-too-large", "aggregate-too-large",
    "invalid-utf8", "script-disabled", "close-idempotent",
  ]),
);
```

- [ ] **Step 2: Prove the test fails before the corpus exists**

Run `pnpm nx test @copilotkit/intelligence -- --run src/adapter-conformance.test.ts`. Expected: FAIL because `registry-adapters-v1.json` cannot be read.

- [ ] **Step 3: Add the corpus and verifier**

Use the existing `registry-sdk-v1.json` identity/projection/bundle values. Give every operation an explicit `atMs`, `kind`, generic SDK result/error, and expected calls/status/native permission/events. Add `verify:adapter-conformance` to `package.json` as `tsx scripts/verify-adapter-corpus.ts`; the verifier exits nonzero for a missing required case, impossible transition, mismatched byte count, duplicate operation timestamp within one case, or secret-bearing telemetry field.

- [ ] **Step 4: Run the corpus tests**

Run `pnpm nx test @copilotkit/intelligence -- --run src/adapter-conformance.test.ts && pnpm --filter @copilotkit/intelligence verify:adapter-conformance`. Expected: both PASS and the verifier prints `17 adapter conformance cases valid`.

- [ ] **Step 5: Commit the serialized corpus boundary**

```bash
git add packages/intelligence/conformance/registry-adapters-v1.json packages/intelligence/scripts/verify-adapter-corpus.ts packages/intelligence/src/adapter-conformance.test.ts packages/intelligence/package.json
git commit -m "test: define Intelligence adapter conformance"
```

## Task 2: Implement the Google ADK package test-first

**Files:**

- Create: `sdk-python-adk/pyproject.toml`
- Create: `sdk-python-adk/project.json`
- Create: `sdk-python-adk/README.md`
- Create: `sdk-python-adk/LICENSE`
- Create: `sdk-python-adk/src/copilotkit_intelligence_adk/__init__.py`
- Create: `sdk-python-adk/src/copilotkit_intelligence_adk/registry.py`
- Create: `sdk-python-adk/src/copilotkit_intelligence_adk/toolset.py`
- Create: `sdk-python-adk/src/copilotkit_intelligence_adk/_snapshot.py`
- Create: `sdk-python-adk/src/copilotkit_intelligence_adk/py.typed`
- Create: `sdk-python-adk/examples/agent.py`
- Create: `sdk-python-adk/tests/api_contract/test_google_adk_contract.py`
- Create: `sdk-python-adk/tests/test_registry.py`
- Create: `sdk-python-adk/tests/test_toolset.py`
- Create: `sdk-python-adk/tests/test_conformance.py`
- Create: `sdk-python-adk/tests/test_public_api.py`
- Create: `sdk-python-adk/tests/test_package.py`

- [ ] **Step 1: Scaffold the independently publishable package**

Set Poetry name/version to `copilotkit-intelligence-adk`/`0.1.0`, Python to `>=3.10`, MIT license, README, repository directory `sdk-python-adk`, packages from `src`, and dependencies `copilotkit>=0.1.94,<1.0.0` and `google-adk>=2.0.0,<3.0.0`. Add pytest, pytest-asyncio, build, and twine as development dependencies. `project.json` exposes Nx `test`, `build`, `check`, and `pack-check` commands rooted in this directory.

- [ ] **Step 2: Pin the native contract with minimum/latest import probes**

The probe imports the ADK public toolset base, inspects its abstract methods, defines a no-op subclass, and passes an instance through the public `LlmAgent(..., tools=[probe])` registration path. Run it once in a clean Python 3.10 environment with `google-adk==2.0.0` and once with `google-adk>=2.0.0,<3.0.0 --upgrade`. Expected: both PASS and print identical required method names; record the verified base and signatures in the README. A mismatch stops this slot.

- [ ] **Step 3: Write failing registry lifecycle tests**

Use an async fake generic client, fake monotonic clock, and barrier. Assert fresh/cached routing, 30-second throttling, one call under 20 concurrent loads, immutable snapshot swap, stale refusal, denial clearing, revoked empty readiness, limits, scripts disabled, telemetry fields, and idempotent close. Expected initial failure: `ImportError: cannot import name 'SkillRegistry'`.

- [ ] **Step 4: Implement `SkillRegistry` minimally to pass lifecycle tests**

`SkillRegistry` owns configuration, lock/singleflight, status, `preload`, `preload_cached`, `load`, and `aclose`; it calls only `client.skills.get(...)` and `client.skills.get_cached(...)`. `_snapshot.py` reads verified `SKILL.md`, enforces the common limits, and returns a frozen tuple. Export frozen status/snapshot dataclasses for annotations only if tests prove they are required; the only promised top-level classes remain `SkillRegistry` and `SkillToolset`.

- [ ] **Step 5: Write and implement the native toolset tests**

Assert `SkillToolset` is an instance of the verified ADK base, uses the verified async lifecycle method, preserves registry order, captures one snapshot for one invocation, returns an authorized empty native value for revoked/empty sets, and never opens a transport or process. Implement only that verified native method and delegate all loading to `SkillRegistry`.

- [ ] **Step 6: Run the shared corpus runner**

Implement `tests/test_conformance.py` as a parameterized runner over `packages/intelligence/conformance/registry-adapters-v1.json`. Run `pnpm nx test @copilotkit/intelligence-adk`. Expected: all 17 cases PASS at `google-adk==2.0.0`.

- [ ] **Step 7: Verify public API, docs, and artifacts**

`__init__.py` sets `__all__ = ["SkillRegistry", "SkillToolset"]`. `examples/agent.py` is a runnable native `LlmAgent` attachment using environment-provided generic client configuration and startup preload. README includes install, fresh/offline preload, the same native attachment, status/readiness, failure behavior, and support ranges. Build with `poetry build`, inspect with `twine check dist/*`, unzip the wheel, and assert README, LICENSE, `py.typed`, and only `copilotkit_intelligence_adk` are present.

- [ ] **Step 8: Commit the ADK package**

```bash
git add sdk-python-adk
git commit -m "feat: add Intelligence Google ADK adapter"
```

## Task 3: Implement the LangGraph Python package test-first

**Files:**

- Create: `sdk-python-langgraph/pyproject.toml`
- Create: `sdk-python-langgraph/project.json`
- Create: `sdk-python-langgraph/README.md`
- Create: `sdk-python-langgraph/LICENSE`
- Create: `sdk-python-langgraph/src/copilotkit_intelligence_langgraph/__init__.py`
- Create: `sdk-python-langgraph/src/copilotkit_intelligence_langgraph/middleware.py`
- Create: `sdk-python-langgraph/src/copilotkit_intelligence_langgraph/_registry_state.py`
- Create: `sdk-python-langgraph/src/copilotkit_intelligence_langgraph/py.typed`
- Create: `sdk-python-langgraph/examples/agent.py`
- Create: `sdk-python-langgraph/tests/api_contract/test_langgraph_contract.py`
- Create: `sdk-python-langgraph/tests/test_middleware.py`
- Create: `sdk-python-langgraph/tests/test_conformance.py`
- Create: `sdk-python-langgraph/tests/test_public_api.py`
- Create: `sdk-python-langgraph/tests/test_package.py`

- [ ] **Step 1: Scaffold exact package metadata**

Set Poetry name/version to `copilotkit-intelligence-langgraph`/`0.1.0`, Python `>=3.10`, MIT/repository metadata, and dependencies `copilotkit>=0.1.94,<1.0.0`, `langgraph>=1.2.2,<2.0.0`, and `langchain>=1.3.2,<2.0.0`. Configure equivalent Nx targets to Task 2.

- [ ] **Step 2: Verify the native middleware boundary at both floors**

In separate Python 3.10 environments, install the exact minimum pair and then newest compatible pair. The probe imports the public `AgentMiddleware` types, defines a no-op middleware using the public request hook supported by both versions, and registers it with `langchain.agents.create_agent(..., middleware=[probe])` without invoking a model. Record the exact hook signature. Do not copy private functions from `sdk-python/copilotkit/copilotkit_lg_middleware.py`.

- [ ] **Step 3: Write the failing public factory and lifecycle tests**

Tests import only `create_skill_registry_middleware`, assert it returns the verified native middleware type, blocks cold starts, throttles and singleflights refreshes, preserves model request/config fields, injects one complete ordered skill value, and refuses stale/denied/script/oversize snapshots before calling the model handler. Expected initial failure: missing export.

- [ ] **Step 4: Implement the minimum middleware**

Put generic lifecycle mechanics in `_registry_state.py`; `middleware.py` creates the verified native middleware and uses the verified model-request replacement/copy API instead of mutating caller state. Support sync and async hooks only when the minimum API provides both; async must never run blocking Registry I/O on the event loop. The factory accepts a generic client, learning-container ID, limits, refresh interval, clock, and telemetry sink; it does not accept or return an agent.

- [ ] **Step 5: Lock the naming contract**

Set `__all__ = ["create_skill_registry_middleware"]`. Assert `createSkillRegistryMiddleware` is not a Python attribute, while module and README text both contain: `create_skill_registry_middleware is the Python spelling of the normative createSkillRegistryMiddleware API.` `examples/agent.py` registers the returned middleware through the verified native `create_agent` API without wrapping the agent.

- [ ] **Step 6: Run corpus, minimum/latest, and artifact checks**

Run the 17 shared cases under the exact minimum pair, repeat under newest compatible versions, then `poetry build && poetry run twine check dist/*`. Assert the wheel imports on Python 3.10 and contains README/LICENSE/`py.typed` and only `copilotkit_intelligence_langgraph`.

- [ ] **Step 7: Commit the Python LangGraph adapter**

```bash
git add sdk-python-langgraph
git commit -m "feat: add Intelligence LangGraph Python adapter"
```

## Task 4: Implement the LangGraph TypeScript package test-first

**Files:**

- Create: `packages/intelligence-langgraph/package.json`
- Create: `packages/intelligence-langgraph/project.json`
- Create: `packages/intelligence-langgraph/tsconfig.json`
- Create: `packages/intelligence-langgraph/tsconfig.check.json`
- Create: `packages/intelligence-langgraph/vitest.config.ts`
- Create: `packages/intelligence-langgraph/README.md`
- Create: `packages/intelligence-langgraph/LICENSE`
- Create: `packages/intelligence-langgraph/src/index.ts`
- Create: `packages/intelligence-langgraph/src/middleware.ts`
- Create: `packages/intelligence-langgraph/src/registry-state.ts`
- Create: `packages/intelligence-langgraph/src/middleware.test.ts`
- Create: `packages/intelligence-langgraph/src/conformance.test.ts`
- Create: `packages/intelligence-langgraph/src/public-api.test.ts`
- Create: `packages/intelligence-langgraph/examples/agent.ts`
- Create: `packages/intelligence-langgraph/tests/api-contract/minimum.test.ts`
- Create: `packages/intelligence-langgraph/tests/api-contract/latest.test.ts`
- Create: `packages/intelligence-langgraph/scripts/verify-package.ts`

- [ ] **Step 1: Scaffold the ESM package and exact ranges**

Use version `0.1.0`, Node engine `>=20`, MIT/repository directory metadata, public access, `dist`/README/LICENSE files, and one root ESM export. Declare peers `@copilotkit/intelligence>=0.1.0 <1.0.0`, `@langchain/langgraph>=1.3.0 <2.0.0`, and `langchain>=1.4.3 <2.0.0`; use the workspace generic SDK and exact framework minima as dev dependencies. Add build, check-types, test, publint, ATTW, and pack verification scripts exposed through Nx.

- [ ] **Step 2: Compile native minimum/latest middleware probes**

Create temporary consumers in `tests/api-contract/.tmp` through `scripts/verify-package.ts`, install the packed adapter with the exact minima and then the unpinned compatible ranges, compile a no-op public middleware registered in `createAgent({ middleware: [...] })`, and delete the temporary consumers in `finally`. Print resolved package versions and save no generated files. A compile failure blocks implementation rather than introducing `as any` or an agent wrapper.

- [ ] **Step 3: Write failing Vitest lifecycle tests**

With fake timers and a deferred generic client, assert cold blocking, throttle boundary, one promise for concurrent callers, ETag refresh delegation, immutable request snapshots, stale/denial refusal, revoked empty behavior, all limits, no child process use, and telemetry. Expected initial failure: `createSkillRegistryMiddleware` is undefined.

- [ ] **Step 4: Implement native middleware and state**

`registry-state.ts` owns the common state machine. `middleware.ts` uses only the verified public LangChain middleware constructor/factory and request-copy API, preserves all unrelated request/config/state keys, and injects the deterministic ordered native skill value. `index.ts` exports only `createSkillRegistryMiddleware` plus necessary public option/status types; it must not re-export the generic SDK. `examples/agent.ts` attaches the middleware through `createAgent({ middleware: [...] })` and is typechecked but excluded from the npm tarball.

- [ ] **Step 5: Run corpus and package verification**

Run `pnpm nx test @copilotkit/intelligence-langgraph`, `pnpm nx run @copilotkit/intelligence-langgraph:check-types`, `pnpm nx run @copilotkit/intelligence-langgraph:build`, publint, ATTW, and `verify-package.ts`. Expected: 17 corpus cases pass, the minimum/latest consumers compile on Node 20, and the tarball contains only declared files with peer ranges unchanged.

- [ ] **Step 6: Commit the TypeScript adapter without the shared lockfile**

```bash
git add packages/intelligence-langgraph
git commit -m "feat: add Intelligence LangGraph TypeScript adapter"
```

The slot leaves `pnpm-lock.yaml` to the serialized integration task.

## Task 5: Implement the Microsoft Agent Framework Python package test-first

**Files:**

- Create: `sdk-python-agent-framework/pyproject.toml`
- Create: `sdk-python-agent-framework/project.json`
- Create: `sdk-python-agent-framework/README.md`
- Create: `sdk-python-agent-framework/LICENSE`
- Create: `sdk-python-agent-framework/src/copilotkit_intelligence_agent_framework/__init__.py`
- Create: `sdk-python-agent-framework/src/copilotkit_intelligence_agent_framework/context_provider.py`
- Create: `sdk-python-agent-framework/src/copilotkit_intelligence_agent_framework/_registry_state.py`
- Create: `sdk-python-agent-framework/src/copilotkit_intelligence_agent_framework/py.typed`
- Create: `sdk-python-agent-framework/examples/agent.py`
- Create: `sdk-python-agent-framework/tests/api_contract/test_agent_framework_contract.py`
- Create: `sdk-python-agent-framework/tests/test_context_provider.py`
- Create: `sdk-python-agent-framework/tests/test_conformance.py`
- Create: `sdk-python-agent-framework/tests/test_public_api.py`
- Create: `sdk-python-agent-framework/tests/test_package.py`

- [ ] **Step 1: Scaffold exact package metadata**

Set Poetry name/version to `copilotkit-intelligence-agent-framework`/`0.1.0`, Python `>=3.10`, MIT/repository metadata, and dependencies `copilotkit>=0.1.94,<1.0.0` and `agent-framework-core>=1.11.0,<2.0.0`. Add the same isolated build/test/package checks as the other Python adapters.

- [ ] **Step 2: Discover and import-test the public context-provider protocol**

Install `agent-framework-core==1.11.0`, inspect only its public exports and type information, implement a no-op provider, and register that provider through the public agent/chat-client options path without running a model. Repeat against newest compatible. Record the verified base/protocol, invocation method, context result type, and registration keyword in README and the probe assertion. The repository's preview-era `Agent` wrappers and `agent_middleware` examples are orientation only and must not be copied as the provider implementation.

- [ ] **Step 3: Write failing provider behavior tests**

Assert `SkillRegistryContextProvider` satisfies the verified runtime protocol, loads before context generation, returns a complete immutable ordered context block, preserves framework context already supplied by other providers, supports cancellation if the native protocol carries it, and enforces every common lifecycle/error/security case without constructing or delegating an agent.

- [ ] **Step 4: Implement the provider and state machine**

Put lifecycle code in `_registry_state.py` and the native protocol implementation in `context_provider.py`. Use the exact public result types from the probe, compose rather than replace existing context, and expose constructor options for generic client, container ID, limits, refresh interval, clock, and telemetry. `__all__` contains only `SkillRegistryContextProvider` plus public option/status types needed for annotation. `examples/agent.py` uses the verified context-provider registration keyword and never defines an agent wrapper.

- [ ] **Step 5: Run corpus, boundaries, and package checks**

Run the 17 corpus cases at `agent-framework-core==1.11.0` and newest compatible, then build/check both distributions and import the wheel on Python 3.10. README includes the exact native registration snippet established by the probe, preload/offline/readiness/status semantics, and fail-closed behavior.

- [ ] **Step 6: Commit the Python Agent Framework adapter**

```bash
git add sdk-python-agent-framework
git commit -m "feat: add Intelligence Agent Framework Python adapter"
```

## Task 6: Implement the Microsoft Agent Framework .NET package test-first

**Files:**

- Create: `sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework/CopilotKit.Intelligence.AgentFramework.csproj`
- Create: `sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework/SkillRegistryContextProvider.cs`
- Create: `sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework/RegistryState.cs`
- Create: `sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/CopilotKit.Intelligence.AgentFramework.Tests.csproj`
- Create: `sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/ApiContractTests.cs`
- Create: `sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/SkillRegistryContextProviderTests.cs`
- Create: `sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/ConformanceTests.cs`
- Create: `sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/PackageTests.cs`
- Create: `sdk-dotnet-agent-framework/examples/Example.csproj`
- Create: `sdk-dotnet-agent-framework/examples/Program.cs`
- Create: `sdk-dotnet-agent-framework/README.md`
- Create: `sdk-dotnet-agent-framework/project.json`

- [ ] **Step 1: Scaffold the independent NuGet project**

Target `net8.0`, enable nullable/implicit usings/XML docs/warnings-as-errors/deterministic build/portable symbols, set PackageId/version `CopilotKit.Intelligence.AgentFramework`/`0.1.0`, MIT/repository/readme metadata, and reference `Microsoft.Agents.AI.Abstractions` `[1.13.0,2.0.0)` plus `CopilotKit.Intelligence` `[0.1.0,1.0.0)`. Use a `UseLocalIntelligenceSdk=true` condition to replace only the latter PackageReference with a ProjectReference during repository tests; pack with the package dependency and assert it in `.nuspec`.

- [ ] **Step 2: Compile the native provider contract at minimum/latest**

Generate two temporary `Directory.Packages.props` files, restore once with exactly `1.13.0` and once with the newest `<2.0.0`, and compile a no-op provider registered through the public Agent Framework context-provider API. Record the verified public interface/base, async method, result type, registration method, and cancellation token position in `ApiContractTests.cs` and README. Do not use the repository's `DelegatingAIAgent` examples as the implementation.

- [ ] **Step 3: Write failing lifecycle and native-provider tests**

Use xUnit, a fake `TimeProvider`, `TaskCompletionSource`, and fake `IntelligenceClient` seam. Assert cold blocking, throttle, singleflight, snapshot atomicity, existing-context composition, cancellation, stale/denial/revoked behavior, limits, script denial, telemetry, disposal, and that `SkillRegistryContextProvider` is assignable to the verified native provider abstraction. Expected initial failure: type not found.

- [ ] **Step 4: Implement the provider without duplicating the SDK**

`RegistryState.cs` calls only `IntelligenceClient.GetAsync` and `GetCachedAsync`, reads verified `SKILL.md` paths, and atomically exchanges one immutable snapshot. `SkillRegistryContextProvider.cs` implements only the verified provider contract, composes native context, propagates cancellation and `IntelligenceSdkException`, and implements idempotent async disposal if required by the native abstraction.

- [ ] **Step 5: Run corpus and pack checks**

Run `pnpm nx test @copilotkit/intelligence-agent-framework-dotnet` and the minimum/latest restore matrix. Pack Release, require exactly one `.nupkg` and one `.snupkg`, inspect the `.nuspec` dependency ranges, list the archive, and compile `examples/Example.csproj` as a clean net8.0 consumer using the package. README includes the same verified registration code and common lifecycle contract.

- [ ] **Step 6: Commit the .NET Agent Framework adapter**

```bash
git add sdk-dotnet-agent-framework
git commit -m "feat: add Intelligence Agent Framework .NET adapter"
```

## Task 7: Integrate workspace lockfile and cross-package CI

**Files:**

- Modify: `pnpm-lock.yaml`
- Create: `.github/workflows/test-intelligence-adapters.yml`

- [ ] **Step 1: Regenerate only the shared lockfile after all package roots exist**

Run `pnpm install --lockfile-only`. Review `git diff -- pnpm-lock.yaml` and require entries for `packages/intelligence-langgraph` with the declared peer ranges; reject unrelated dependency upgrades.

- [ ] **Step 2: Add the failing CI workflow structure test**

Add a test script in the workflow that parses its checked-in matrix and requires exactly ten framework cells: each of `adk-python`, `langgraph-python`, `langgraph-typescript`, `agent-framework-python`, and `agent-framework-dotnet` with `minimum` and `latest`.

- [ ] **Step 3: Implement the matrix jobs**

Path filters include all five package roots, three generic SDK roots, the shared corpus, the workflow, and dependency lockfiles. Every cell checks out without persisted credentials, installs the declared runtime floor/range, prints resolved versions, runs its Nx target and corpus runner, and uploads dependency/version plus test reports. Set `fail-fast: false`; no cell has registry write credentials.

- [ ] **Step 4: Add artifact smoke jobs**

Build all three Python distributions, the npm tarball, and NuGet packages. Verify contents and compile/import clean consumers. Run generic SDK tests first through Nx, proving adapters did not change their identities or APIs.

- [ ] **Step 5: Run workflow lint and local matrices available on the host**

Run `pnpm nx test @copilotkit/intelligence`, all five adapter Nx test/check/build targets, `pnpm check-format`, and the repository workflow lint command from `.github/workflows/lint-release-workflows.yml`. Expected: PASS; unavailable host runtimes are exercised by CI rather than silently skipped.

- [ ] **Step 6: Commit integration CI**

```bash
git add pnpm-lock.yaml .github/workflows/test-intelligence-adapters.yml
git commit -m "ci: test Intelligence adapters at support boundaries"
```

## Task 8: Add independent release lanes and ownership

**Files:**

- Modify: `release.config.json`
- Modify: `.github/CODEOWNERS`
- Modify: `.github/workflows/publish-release.yml`
- Create: `scripts/release/detect-intelligence-adapter-version-changes.ts`
- Modify: `scripts/release/lib/config.test.ts`
- Modify: `scripts/release/lib/versions.test.ts`
- Modify: `.github/workflows/lint-release-workflows.yml`

- [ ] **Step 1: Write failing release configuration tests**

Assert `intelligence-langgraph` is a non-shared npm scope containing only `@copilotkit/intelligence-langgraph`; assert the detector maps each exact manifest to package ID, registry, version, and tag prefix; assert no two packages share a version source or concurrency key.

- [ ] **Step 2: Add exact ownership entries**

Resolve the Intelligence/Learning team slug with the command in “Repository layout and file ownership,” require one result, then add all five package roots, the shared adapter corpus, adapter CI, and adapter release detector to that team in `.github/CODEOWNERS` while preserving global owners.

- [ ] **Step 3: Implement fail-loud version detection**

The detector accepts one of the five package IDs, reads only its manifest, validates stable SemVer, queries only its registry, emits `should_publish`, `name`, `version`, `directory`, and `tag_prefix`, returns false only when the exact version already exists, and throws on authentication, transport, malformed response, or a published newer version.

- [ ] **Step 4: Add independent build/publish jobs**

Extend `publish-release.yml` without changing existing generic SDK lanes. Three PyPI matrix entries, one npm scope, and one NuGet entry each detect their own manifest change, use a package-specific concurrency group, build/test before credential exposure, inspect artifacts, publish idempotently, verify registry visibility, and tag only that package. Jobs have no `needs` edge between adapter identities.

- [ ] **Step 5: Update trusted-publisher documentation and workflow allowlists**

Document the exact workflow filename, environment, and package identity for each PyPI/npm trusted publisher next to the publish job. Add every changed release-sensitive file to `lint-release-workflows.yml` path filters and allowlist verification. NuGet continues to use the scoped secret only at push time.

- [ ] **Step 6: Run release dry-runs and detector tests**

Run release unit tests through Nx, the shell/workflow lints, and a dry-run for each package that builds and inspects but does not publish/tag. Expected: five separate summaries and no generic SDK version mutation.

- [ ] **Step 7: Commit the serialized release boundary**

```bash
git add release.config.json .github/CODEOWNERS .github/workflows/publish-release.yml .github/workflows/lint-release-workflows.yml scripts/release/detect-intelligence-adapter-version-changes.ts scripts/release/lib/config.test.ts scripts/release/lib/versions.test.ts
git commit -m "ci: release Intelligence adapters independently"
```

## Task 9: Final cross-package verification and integration order

Integration order is fixed: shared corpus; five file-disjoint adapter commits in any order; lockfile/CI; release/ownership. If a package slot needs a corpus change, it reports the missing scenario and waits for the serialized corpus owner; it does not edit the corpus itself. If two slots discover incompatible framework semantics, preserve the common observable contract and isolate the difference inside their native hook.

- [ ] **Step 1: Verify exact public names and dependency bounds**

Search manifests and built artifacts for all five package IDs and public symbols. Assert the normative `createSkillRegistryMiddleware` mapping sentence exists in Python docs/tests, all exclusive next-major bounds are exact, Python/Node/net8 floors are present, and no adapter declares a runtime dependency on another adapter.

- [ ] **Step 2: Verify generic SDK preservation and no duplicate HTTP**

Run generic TypeScript/Python/.NET Registry tests unchanged. Search adapter production roots for `fetch(`, `urlopen`, `HttpClient`, projection endpoint literals, ZIP extraction, pointer filenames, and bundle verification; expected: no matches except documentation that says those concerns belong to the generic SDK.

- [ ] **Step 3: Run the complete test/build/package matrix**

Run the five minimum and five latest cells, generic SDK suites, corpus verifier, formatter, type checks, publint/ATTW, Python distribution checks, and NuGet consumer compile. Capture resolved dependency versions in the final CI summary.

- [ ] **Step 4: Inspect state/failure acceptance tests**

Require explicit passing tests for load/preload/readiness/status, atomic memory and disk delegation, throttle/singleflight/ETag, stale/denial/cold start, size/script limits, telemetry, cancellation/disposal, empty/revoked, and generic canonical error propagation in every adapter runner.

- [ ] **Step 5: Inspect release and ownership acceptance tests**

Require five independent versions, concurrency keys, tags, artifact inspections, and registry checks; exact Intelligence/Learning CODEOWNERS coverage; minimum/latest CI; and no shared release version mutation.

- [ ] **Step 6: Final repository checks**

Run `pnpm check-format` and `git diff --check`. Review `git status --short` and the complete diff. Expected: only planned files, clean formatting, no whitespace errors, no generated temporary consumers, and no uncommitted build artifacts.

- [ ] **Step 7: Commit any integration-only corrections**

```bash
git add <only the files changed by the integration correction>
git commit -m "fix: integrate Intelligence framework adapters"
```

Do not squash package boundaries: the shared corpus, each adapter, CI integration, and release integration remain independently reviewable commits.
