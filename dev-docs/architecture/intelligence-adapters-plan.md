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
| PyPI `copilotkit-intelligence-adk` | `SkillRegistry`, `SkillToolset` | `google-adk>=2.0.0,<3.0.0`; Python >=3.10 | `copilotkit>=0.1.95,<1.0.0` |
| PyPI `copilotkit-intelligence-langgraph` | `createSkillRegistryMiddleware`, `create_skill_registry_middleware` | `langgraph>=1.2.2,<2.0.0`, `langchain>=1.3.2,<2.0.0`; Python >=3.10 | `copilotkit>=0.1.95,<1.0.0` |
| npm `@copilotkit/intelligence-langgraph` | `createSkillRegistryMiddleware` | `@langchain/langgraph>=1.3.0 <2.0.0`, `langchain>=1.4.4 <2.0.0`; Node >=20 | peer `@copilotkit/intelligence>=0.1.0 <1.0.0` |
| PyPI `copilotkit-intelligence-agent-framework` | `SkillRegistryContextProvider` | `agent-framework-core>=1.11.0,<2.0.0`; Python >=3.10 | `copilotkit>=0.1.95,<1.0.0` |
| NuGet `CopilotKit.Intelligence.AgentFramework` | `SkillRegistryContextProvider` | `Microsoft.Agents.AI.Abstractions` `[1.13.0,2.0.0)`; `net8.0` | `CopilotKit.Intelligence` `[0.1.0,1.0.0)` |

The normative cross-language symbol is `createSkillRegistryMiddleware`. Python exports that exact camelCase symbol and the idiomatic alias `create_skill_registry_middleware`; both names reference the same factory object and appear in `__all__`. Its README, docstring, and API test say that `create_skill_registry_middleware` is the Python spelling of the normative `createSkillRegistryMiddleware` API.

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

One `shared-integration` owner serializes every file outside the five exclusive roots. No package slot may edit any of these paths:

- generic Python SDK prerequisite: `sdk-python/copilotkit/intelligence.py`, `sdk-python/copilotkit/__init__.py`, `sdk-python/tests/test_intelligence.py`, `sdk-python/README.md`, `sdk-python/pyproject.toml`, `sdk-python/poetry.lock`, and `sdk-python/uv.lock`;
- shared conformance and CI contracts: `packages/intelligence/conformance/registry-adapters-v1.json`, `packages/intelligence/conformance/adapter-ci-matrix-v1.json`, `packages/intelligence/scripts/verify-adapter-corpus.ts`, `packages/intelligence/src/adapter-conformance.test.ts`, `packages/intelligence/src/adapter-ci-matrix.test.ts`, `packages/intelligence/package.json`, `.github/workflows/test-intelligence-adapters.yml`, and `pnpm-lock.yaml`;
- release and ownership integration: `release.config.json`, `.github/CODEOWNERS`, `.github/workflows/publish-release.yml`, `.github/workflows/stable-release.yml`, `.github/workflows/canary.yml`, `.github/workflows/lint-release-workflows.yml`, `scripts/release/detect-intelligence-adapter-version-changes.ts`, `scripts/release/detect-intelligence-adapter-version-changes.test.ts`, `scripts/release/fixtures/intelligence-adapters-unpublished.json`, `scripts/release/lib/config.ts`, `scripts/release/lib/config.test.ts`, `scripts/release/lib/changes.test.ts`, `scripts/release/lib/versions.test.ts`, `scripts/release/lib/build-release-notification.ts`, `scripts/release/lib/build-release-notification.wrapper.test.ts`, and `scripts/release/verify-release-scope-dropdowns.sh`.

The serialized owner lands the generic Python SDK prerequisite as a separate PR, merges it, and waits for `copilotkit==0.1.95` to install from PyPI before the adapter integration PR may merge. Adapter development and PR CI do not wait on PyPI: they build `sdk-python/dist/copilotkit-0.1.95-py3-none-any.whl` from the prerequisite commit and install that exact local wheel into each Python adapter's isolated virtual environment. The `adk-python`, `langgraph-python`, and `agent-framework-python` slots depend on the Task 0 commit and PyPI release gate for merge/release, while TypeScript and .NET depend only on the corpus commit. Only after all five exclusive-root commits land does the same owner update the lockfile, CI, release files, and ownership. This dependency order prevents an adapter from compensating for a missing generic-SDK projection by reading cache metadata.

Every adapter `project.json` defines the same four Nx targets; integration never guesses language-specific target names:

| Project name | `test` command | `check` command | `build` command | `pack-check` command |
| --- | --- | --- | --- | --- |
| `@copilotkit/intelligence-adk` | `sdk-python-adk/.venv/bin/pytest sdk-python-adk/tests -v` | `sdk-python-adk/.venv/bin/python -m compileall -q sdk-python-adk/src && cd sdk-python-adk && poetry check` | `cd sdk-python-adk && poetry build` | `sdk-python-adk/.venv/bin/twine check sdk-python-adk/dist/* && sdk-python-adk/.venv/bin/python -m zipfile -l sdk-python-adk/dist/copilotkit_intelligence_adk-0.1.0-py3-none-any.whl` |
| `@copilotkit/intelligence-langgraph-python` | `sdk-python-langgraph/.venv/bin/pytest sdk-python-langgraph/tests -v` | `sdk-python-langgraph/.venv/bin/python -m compileall -q sdk-python-langgraph/src && cd sdk-python-langgraph && poetry check` | `cd sdk-python-langgraph && poetry build` | `sdk-python-langgraph/.venv/bin/twine check sdk-python-langgraph/dist/* && sdk-python-langgraph/.venv/bin/python -m zipfile -l sdk-python-langgraph/dist/copilotkit_intelligence_langgraph-0.1.0-py3-none-any.whl` |
| `@copilotkit/intelligence-langgraph` | `pnpm --dir packages/intelligence-langgraph vitest run` | `pnpm --dir packages/intelligence-langgraph check-types && pnpm --dir packages/intelligence-langgraph publint && pnpm --dir packages/intelligence-langgraph attw` | `pnpm --dir packages/intelligence-langgraph build` | `pnpm --dir packages/intelligence-langgraph verify-package` |
| `@copilotkit/intelligence-agent-framework-python` | `sdk-python-agent-framework/.venv/bin/pytest sdk-python-agent-framework/tests -v` | `sdk-python-agent-framework/.venv/bin/python -m compileall -q sdk-python-agent-framework/src && cd sdk-python-agent-framework && poetry check` | `cd sdk-python-agent-framework && poetry build` | `sdk-python-agent-framework/.venv/bin/twine check sdk-python-agent-framework/dist/* && sdk-python-agent-framework/.venv/bin/python -m zipfile -l sdk-python-agent-framework/dist/copilotkit_intelligence_agent_framework-0.1.0-py3-none-any.whl` |
| `@copilotkit/intelligence-agent-framework-dotnet` | `dotnet test sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/CopilotKit.Intelligence.AgentFramework.Tests.csproj -c Release -p:UseLocalIntelligenceSdk=true` | `dotnet format sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/CopilotKit.Intelligence.AgentFramework.Tests.csproj --verify-no-changes --no-restore` | `dotnet build sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework/CopilotKit.Intelligence.AgentFramework.csproj -c Release -p:UseLocalIntelligenceSdk=true` | `bash sdk-dotnet-agent-framework/scripts/verify-package.sh` |

Each target uses `nx:run-commands`, declares its build/test artifact outputs, and sets the repository root as `cwd`. The TypeScript package keeps its `check-types`, `publint`, `attw`, and `verify-package` package scripts; Nx's common `check` and `pack-check` targets call those exact scripts. The .NET root also creates `sdk-dotnet-agent-framework/scripts/verify-package.sh`, which packs, inspects the `.nuspec`, and compiles the clean example consumer.

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

## Generic Python SDK projection prerequisite

The three Python adapters need one additive generic-SDK release before their parallel slots begin. Version `copilotkit==0.1.95` adds immutable, verified projection/manifest views to `sdk-python/copilotkit/intelligence.py` and exports them from `sdk-python/copilotkit/__init__.py`:

```python
@dataclass(frozen=True)
class IntelligenceSkillFileDescriptor:
    path: str
    role: str
    media_type: str
    byte_length: int
    raw_sha256: str

@dataclass(frozen=True)
class IntelligenceSkillManifestDescriptor:
    agent_skills_profile: str
    manifest_sha256: str
    files: tuple[IntelligenceSkillFileDescriptor, ...]

@dataclass(frozen=True)
class IntelligenceSkillDescriptor:
    skill_id: str
    version_id: str
    position: int
    name: str
    description: str | None
    directory: Path
    manifest: IntelligenceSkillManifestDescriptor
```

`IntelligenceSkillSet` gains final field `skill_descriptors: tuple[IntelligenceSkillDescriptor, ...] = ()`, preserving existing positional construction. The generic client fills it only after projection identity, manifest, every file digest/size, and atomic install verification complete. Each descriptor directory is the verified immutable install directory; tuples and frozen dataclasses prevent adapter mutation. This is a projection, not cache internals: it exposes no pointer filename, staging directory, raw metadata JSON, token, project namespace, or container ID.

All Python `_snapshot.py`/`_registry_state.py` implementations consume only `skill_set.skill_descriptors`. They reject the entire load before reading content when any descriptor has `file.role == "script"` or normalized `file.path` starts with `scripts/`; otherwise they open only `descriptor.directory / "SKILL.md"` with strict UTF-8 and render the descriptor's ID, version, position, name, and nullable description. An empty `skill_descriptors` tuple is valid only for a verified empty or revoked set; a non-empty legacy `skills` tuple paired with empty descriptors fails closed with `INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION`.

## Native API verification gates

The repository locks or demonstrates older framework APIs, but does not contain installed source for `google-adk` 2.0, `langgraph` 1.2.2/`langchain` 1.3.2, `langchain` TypeScript 1.4.4, `agent-framework-core` 1.11.0, or `Microsoft.Agents.AI.Abstractions` 1.13.0. Exact inheritance names and callback signatures must therefore be discovered, compiled, and recorded before production implementation rather than guessed in this plan.

Each adapter slot first creates `tests/api_contract/` probes at both the exact minimum and the newest version below the next major. A probe prints the package version and native base/interface signature, then compiles or imports a minimal no-op extension registered through the same public constructor/API an application will use. The resulting checked-in `README.md` compatibility section names the verified native hook. Production work cannot start until both probes pass; if the minimum lacks the required native extension point, the slot reports that dependency-boundary conflict instead of substituting an agent wrapper.

## Shared adapter conformance corpus

`registry-adapters-v1.json` is test data, not a published runtime package. It contains exactly 35 deterministic fake-clock cases. The original 17 are `cold-fresh-load`, `explicit-cached-preload`, `throttle-hit`, `concurrent-singleflight`, `etag-unchanged`, `changed-revision`, `empty`, `revoked`, `transient-stale`, `integrity-stale`, `denial`, `too-many-skills`, `skill-md-too-large`, `aggregate-too-large`, `invalid-utf8`, `script-disabled`, and `close-idempotent`. The required additions are `readiness-ready`, `readiness-timeout`, `readiness-denied-rejects`, `readiness-stale-rejects`, `readiness-closed-rejects`, `retry-after-failed-throttle-window`, `load-after-close-rejects`, `telemetry-sink-failure-singleflight`, `error-category-auth-denied`, `error-category-permission-denied`, `http-401-denied`, `http-403-denied`, `http-404-denied`, `http-410-denied`, `container-archived-denied`, `project-mismatch-denied`, `container-not-found-denied`, and `registry-unrecoverable-denied`.

Every case declares ordered input operations, generic-client calls, expected status transitions, readiness result/error, whether a native hook may proceed, telemetry event names, canonical error code/category/retryability, and exact rendered skill records. The telemetry failure case starts two callers behind one barrier and requires one Registry call, one sink exception instance, and both callers rejecting with that same exception. Retry-after-failure requires no new call inside the failed attempt's 30-second window and exactly one new call at the boundary. Every post-close operation, including a load created after close completes, rejects with the canonical closed error.

Each adapter includes a small test-only runner that consumes this JSON directly from `../packages/intelligence/conformance/` (with the correct relative depth for its root). The corpus has its own `schemaVersion` and `contractVersion`; adapter package versions never appear in it, and released packages do not contain or depend on the corpus. Thus a corpus change requires all five repository test runners to pass but does not force five releases. `verify-adapter-corpus.ts` validates exact 35-name equality, uniqueness, transition completeness, byte counts, readiness outcomes, post-close rejection, joined telemetry failure, and a one-to-one table covering all ten explicit denial classifications.

## Uniform README and public API acceptance

Every package README uses these exact level-two headings, and its public-API/package test reads the shipped README and asserts all ten headings plus the stated smoke behavior:

| Heading | Required content and smoke assertion |
| --- | --- |
| `## Installation` | Exact package ID, supported runtime floor, and bounded framework/generic-SDK dependencies; clean consumer installs the built artifact. |
| `## Native registration` | Compilable/importable native framework registration using the required public symbol; no agent wrapper or builder. |
| `## Lifecycle and preload` | Fresh preload, explicit cached preload, request-time load, readiness/status, and cold fail-closed behavior. |
| `## Fresh and cached data` | Networked versus offline routing, freshness/source status, throttle, singleflight, and no implicit stale fallback. |
| `## Limits and scripts` | Exact 128/262144/1048576 limits, strict UTF-8, full-set failure, and script role/path denial. |
| `## Telemetry` | Event list, permitted fields, forbidden secrets/content, and explicit sink-failure propagation to joined callers. |
| `## Errors` | Canonical auth, permission, 401, 403, 404, 410, archived, project-mismatch, not-found, unrecoverable, stale, and adapter validation errors. |
| `## Closing` | Idempotent close/disposal, in-flight invocation semantics, and rejection of every future load. |
| `## Compatibility` | Exact minimum/exclusive-major ranges and the native hook verified at minimum and latest. |
| `## Ownership and release` | Intelligence/Learning ownership, independent version/tag/publish lane, and no coupling to another adapter release. |

The exact tests are `test_readme_and_public_api_contract()` in each Python `tests/test_public_api.py`, `README and public API contract > exports and documents every required behavior` in TypeScript `src/public-api.test.ts`, and `ReadmeAndPublicApiContract` in .NET `PackageTests.cs`. Each compiles or imports the README registration snippet from the built artifact and asserts the package exports only its declared adapter API plus necessary public option/status types.

## Compatibility and release policy

PR CI has ten framework jobs: minimum and newest-compatible for each package. Minimum jobs install the exact lower bounds above. Newest jobs resolve the declared exclusive-major ranges without a lock override, print the resolved dependency tree, and archive it with test results. Python jobs run on 3.10; an additional packaging smoke job imports each wheel on the repository's normal Python matrix. TypeScript runs on Node 20 and the repository current Node. .NET runs `net8.0` and resolves the minimum and newest allowed NuGet versions through generated `Directory.Packages.props` files.

The standard npm release machinery gains a non-shared `intelligence-langgraph` scope whose only package and version source are `@copilotkit/intelligence-langgraph`. The existing `publish-release.yml` receives three separately detected PyPI adapter jobs and one separately detected NuGet adapter job; each key is package identity plus version, each publishes only when that package's own manifest version changed, and no adapter waits for another adapter. The three Python adapter build jobs share only the prerequisite `python-adapter-sdk-gate`, which proves `copilotkit==0.1.95` is installable from PyPI, then fan out without edges between adapter identities. Build jobs have no publish credential, PyPI uses OIDC trusted publishing, npm retains its existing OIDC lane, and NuGet receives its API key only in the final push step. Tags are `intelligence-adk-python/vX.Y.Z`, `intelligence-langgraph-python/vX.Y.Z`, `intelligence-langgraph/vX.Y.Z`, `intelligence-agent-framework-python/vX.Y.Z`, and `intelligence-agent-framework-dotnet/vX.Y.Z`.

Release acceptance requires inspecting wheel/sdist contents, npm tarball contents plus publint/ATTW, and NuGet `.nuspec` plus symbols. Every artifact must contain README/license/repository metadata, only its own public package, and bounded runtime dependencies. The release detector treats an already-published identical version as an idempotent success and any registry/auth/network ambiguity as a hard failure.

## Task 0: Merge and publish the generic Python verified-descriptor prerequisite

**Dependency:** This serialized task must complete before Tasks 2, 3, or 5 begin.

**Files:**

- Modify: `sdk-python/copilotkit/intelligence.py`
- Modify: `sdk-python/copilotkit/__init__.py`
- Modify: `sdk-python/tests/test_intelligence.py`
- Modify: `sdk-python/README.md`
- Modify: `sdk-python/pyproject.toml`
- Modify: `sdk-python/poetry.lock`
- Modify: `sdk-python/uv.lock`

- [ ] **Step 1: Install the existing SDK development environment**

Run `cd sdk-python && poetry install --with dev`. Expected: the existing locked environment installs without changing either lockfile. Return to the repository root with `cd ..`.

- [ ] **Step 2: Write the failing immutable-projection tests**

Add `test_skill_descriptors_are_immutable_verified_projection_views()` and `test_skill_descriptors_are_not_returned_before_full_verification()` to `sdk-python/tests/test_intelligence.py`. The first asserts exact descriptor fields, tuple order, `FrozenInstanceError` on assignment, manifest SHA/file role/media type/byte length/raw SHA, and a normalized verified directory. The second injects a bad file digest and asserts the generic integrity exception is raised before an `IntelligenceSkillSet` or descriptor is returned. Add `test_legacy_skill_set_constructor_remains_compatible()` to construct the old seven positional fields and assert `skill_descriptors == ()`.

Run `cd sdk-python && poetry run pytest tests/test_intelligence.py::test_skill_descriptors_are_immutable_verified_projection_views tests/test_intelligence.py::test_skill_descriptors_are_not_returned_before_full_verification tests/test_intelligence.py::test_legacy_skill_set_constructor_remains_compatible -v`. Expected RED: imports/constructor fail because the descriptor types and final field do not exist. Return with `cd ..`.

- [ ] **Step 3: Implement the smallest additive descriptor surface**

Add the three frozen dataclasses exactly as specified in “Generic Python SDK projection prerequisite,” append `skill_descriptors` as the defaulted last `IntelligenceSkillSet` field, build descriptors inside `_result()` only from the already verified set and per-skill manifests, and export all three types from both module `__all__` lists. Keep `IntelligenceSkill`, `IntelligenceSkillSet.skills`, client methods, cache paths, and wire types source-compatible. Add the public descriptor contract and the “verified after digest checks” guarantee to `sdk-python/README.md`.

- [ ] **Step 4: Prove GREEN and version compatibility**

Set the generic SDK version to `0.1.95`, run `cd sdk-python && poetry lock && uv lock`, then run `poetry run pytest tests/test_intelligence.py -v`, `poetry check`, and `uv lock --check`. Expected GREEN: all existing and new tests pass; the lock checks are clean; only the project version changes. Return with `cd ..`.

- [ ] **Step 5: Build and inspect the prerequisite artifact**

Run `cd sdk-python && poetry build && poetry run python -m zipfile -l dist/copilotkit-0.1.95-py3-none-any.whl && poetry run python -c 'import copilotkit; assert copilotkit.IntelligenceSkillDescriptor; assert copilotkit.IntelligenceSkillManifestDescriptor; assert copilotkit.IntelligenceSkillFileDescriptor'`. Expected: wheel/sdist build, descriptor modules appear in the wheel, and public imports succeed. Return with `cd ..`.

- [ ] **Step 6: Commit the serialized prerequisite**

```bash
git add sdk-python/copilotkit/intelligence.py sdk-python/copilotkit/__init__.py sdk-python/tests/test_intelligence.py sdk-python/README.md sdk-python/pyproject.toml sdk-python/poetry.lock sdk-python/uv.lock
git commit -m "feat: expose verified Intelligence skill descriptors"
```

- [ ] **Step 7: Merge this prerequisite separately and wait for PyPI**

This commit is its own PR and merges to `main` before the adapter integration PR. The existing `publish-release.yml` `build-python` job detects the `sdk-python/pyproject.toml` version change, `publish-python` publishes with the existing `pypi` trusted publisher, and its built-in visibility loop must succeed. After merge, while still on the prerequisite branch, run:

```bash
MERGE_SHA=$(gh pr view --json mergeCommit --jq '.mergeCommit.oid')
RUN_ID=$(gh run list --workflow publish-release.yml --event pull_request --branch main --limit 20 --json databaseId,headSha | jq -r --arg sha "$MERGE_SHA" 'first(.[] | select(.headSha == $sha)).databaseId')
test -n "$RUN_ID"
gh run watch "$RUN_ID" --exit-status
for attempt in $(seq 1 30); do
  curl -fsS https://pypi.org/pypi/copilotkit/0.1.95/json >/dev/null && break
  test "$attempt" -lt 30
  sleep 10
done
python3.10 -m venv /tmp/copilotkit-intelligence-sdk-095-probe
/tmp/copilotkit-intelligence-sdk-095-probe/bin/pip install --no-cache-dir copilotkit==0.1.95
/tmp/copilotkit-intelligence-sdk-095-probe/bin/python -c 'from copilotkit import IntelligenceSkillDescriptor, IntelligenceSkillManifestDescriptor, IntelligenceSkillFileDescriptor'
```

Expected GREEN: the workflow concludes successfully, the exact-version PyPI JSON resolves, the wheel installs without a repository path, and all three descriptor imports succeed. Until this gate passes, Tasks 2, 3, and 5 may be developed with the local wheel but their PR cannot merge and none of their release lanes may build an artifact.

## Task 1: Create and validate the shared corpus

**Files:**

- Create: `packages/intelligence/conformance/registry-adapters-v1.json`
- Create: `packages/intelligence/scripts/verify-adapter-corpus.ts`
- Create: `packages/intelligence/src/adapter-conformance.test.ts`
- Modify: `packages/intelligence/package.json`

- [ ] **Step 0: Install the existing TypeScript workspace**

Run `corepack enable && pnpm install --frozen-lockfile && node --version`. Expected setup GREEN: the current lockfile installs and Node is at least 20.

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
    "readiness-ready", "readiness-timeout", "readiness-denied-rejects",
    "readiness-stale-rejects", "readiness-closed-rejects",
    "retry-after-failed-throttle-window", "load-after-close-rejects",
    "telemetry-sink-failure-singleflight", "error-category-auth-denied",
    "error-category-permission-denied", "http-401-denied",
    "http-403-denied", "http-404-denied", "http-410-denied",
    "container-archived-denied", "project-mismatch-denied",
    "container-not-found-denied", "registry-unrecoverable-denied",
  ]),
);
```

- [ ] **Step 2: Prove the test fails before the corpus exists**

Run `pnpm nx test @copilotkit/intelligence -- --run src/adapter-conformance.test.ts`. Expected: FAIL because `registry-adapters-v1.json` cannot be read.

- [ ] **Step 3: Add the corpus and verifier**

Use the existing `registry-sdk-v1.json` identity/projection/bundle values. Give every operation an explicit `atMs`, `kind`, generic SDK result/error, and expected calls/status/readiness/native permission/events. Give every error operation explicit `code`, `category`, `retryable`, HTTP status when applicable, and expected cause identity. Add `verify:adapter-conformance` to `packages/intelligence/package.json` as `tsx scripts/verify-adapter-corpus.ts`; the verifier exits nonzero for a missing/extra required case, impossible transition, mismatched byte count, duplicate operation timestamp within one case, missing error classification, a retry before/after the wrong boundary, post-close success, unequal joined telemetry errors, or a secret-bearing telemetry field.

- [ ] **Step 4: Run the corpus tests**

Run `pnpm nx test @copilotkit/intelligence -- --run src/adapter-conformance.test.ts && pnpm --filter @copilotkit/intelligence verify:adapter-conformance`. Expected: both PASS and the verifier prints `35 adapter conformance cases valid`; the test named `classifies every permanent denial source exactly once` reports ten classifications.

- [ ] **Step 5: Commit the serialized corpus boundary**

```bash
git add packages/intelligence/conformance/registry-adapters-v1.json packages/intelligence/scripts/verify-adapter-corpus.ts packages/intelligence/src/adapter-conformance.test.ts packages/intelligence/package.json
git commit -m "test: define Intelligence adapter conformance"
```

## Task 2: Implement the Google ADK package test-first

**Dependencies:** Task 0 commit for local development; Task 0 PyPI gate and Task 1 commit before merge/release.

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

Set Poetry name/version to `copilotkit-intelligence-adk`/`0.1.0`, Python to `>=3.10`, MIT license, README, repository directory `sdk-python-adk`, packages from `src`, and dependencies `copilotkit>=0.1.95,<1.0.0` and `google-adk>=2.0.0,<3.0.0`. Add pytest, pytest-asyncio, build, and twine as development dependencies. Define the `@copilotkit/intelligence-adk` Nx `test`, `check`, `build`, and `pack-check` targets with the exact commands in the common target table.

Run `cd sdk-python && poetry build && cd .. && python3.10 -m venv sdk-python-adk/.venv && sdk-python-adk/.venv/bin/pip install --upgrade pip && sdk-python-adk/.venv/bin/pip install sdk-python/dist/copilotkit-0.1.95-py3-none-any.whl 'google-adk>=2.0.0,<3.0.0' pytest pytest-asyncio build twine && sdk-python-adk/.venv/bin/pip install --no-deps -e sdk-python-adk && sdk-python-adk/.venv/bin/python -c 'from copilotkit import IntelligenceSkillDescriptor'`. Expected setup GREEN: Python 3.10+, the adapter imports editably, and `copilotkit` comes from the exact local 0.1.95 wheel without a PyPI lookup for that dependency.

- [ ] **Step 2: Pin the native contract with minimum/latest import probes**

The probe imports the ADK public toolset base, inspects its abstract methods, defines a no-op subclass, and passes an instance through the public `LlmAgent(..., tools=[probe])` registration path. Run it once in a clean Python 3.10 environment with `google-adk==2.0.0` and once with `google-adk>=2.0.0,<3.0.0 --upgrade`. Expected: both PASS and print identical required method names; record the verified base and signatures in the README. A mismatch stops this slot.

Execute `sdk-python-adk/.venv/bin/pip install 'google-adk==2.0.0' && sdk-python-adk/.venv/bin/pytest sdk-python-adk/tests/api_contract/test_google_adk_contract.py::test_native_toolset_registration_contract -v && sdk-python-adk/.venv/bin/pip install --upgrade 'google-adk>=2.0.0,<3.0.0' && sdk-python-adk/.venv/bin/pytest sdk-python-adk/tests/api_contract/test_google_adk_contract.py::test_native_toolset_registration_contract -v`; expected GREEN is two imports/registrations and printed resolved versions.

- [ ] **Step 3: Write failing registry lifecycle tests**

Use an async fake generic client, fake monotonic clock, and barrier. Assert fresh/cached routing, 30-second throttling, one call under 20 concurrent loads, immutable snapshot swap, stale refusal, denial clearing, revoked empty readiness, limits, scripts disabled, telemetry fields, and idempotent close. Expected initial failure: `ImportError: cannot import name 'SkillRegistry'`.

Run `sdk-python-adk/.venv/bin/pytest sdk-python-adk/tests/test_registry.py::test_load_is_singleflight_and_retries_after_failed_window sdk-python-adk/tests/test_registry.py::test_wait_until_ready_success_timeout_and_immediate_rejections sdk-python-adk/tests/test_registry.py::test_close_rejects_future_loads sdk-python-adk/tests/test_registry.py::test_joined_callers_share_telemetry_sink_failure -v`; expected RED is the missing `SkillRegistry`. After implementation, rerun the identical command; expected GREEN is four passing tests and no unexpected generic-client call.

- [ ] **Step 4: Implement `SkillRegistry` minimally to pass lifecycle tests**

`SkillRegistry` owns configuration, lock/singleflight, status, `preload`, `preload_cached`, `load`, and `aclose`; it calls only `client.skills.get(...)` and `client.skills.get_cached(...)`. `_snapshot.py` consumes only `IntelligenceSkillSet.skill_descriptors`, rejects script roles/paths before reads, reads strict-UTF-8 root `SKILL.md` files from descriptor directories, enforces the common limits, and returns a frozen tuple. A non-empty legacy `skills` value without descriptors fails with `INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION`. Export frozen status/snapshot dataclasses for annotations only if tests prove they are required; the only promised top-level classes remain `SkillRegistry` and `SkillToolset`.

- [ ] **Step 5: Write and implement the native toolset tests**

Assert `SkillToolset` is an instance of the verified ADK base, uses the verified async lifecycle method, preserves registry order, captures one snapshot for one invocation, returns an authorized empty native value for revoked/empty sets, and never opens a transport or process. Implement only that verified native method and delegate all loading to `SkillRegistry`.

- [ ] **Step 6: Run the shared corpus runner**

Implement `test_adapter_conformance(case: dict[str, object])` in `tests/test_conformance.py` as a parameterized runner over `packages/intelligence/conformance/registry-adapters-v1.json`. Run `pnpm nx test @copilotkit/intelligence-adk`. Expected: all 35 cases PASS at `google-adk==2.0.0`, including readiness success/timeout/immediate rejection, failed-window retry, post-close load rejection, joined telemetry-sink failure, and all ten permanent denial classifications.

- [ ] **Step 7: Verify public API, docs, and artifacts**

`__init__.py` sets `__all__ = ["SkillRegistry", "SkillToolset"]`. Add `test_readme_and_public_api_contract()` with all ten uniform README assertions; its registration snippet imports from the built wheel and attaches to native `LlmAgent`. Run `sdk-python-adk/.venv/bin/pytest sdk-python-adk/tests/test_public_api.py::test_readme_and_public_api_contract sdk-python-adk/tests/test_package.py -v && pnpm nx run @copilotkit/intelligence-adk:build && pnpm nx run @copilotkit/intelligence-adk:pack-check`; expected GREEN is exact exports, strict ranges, `py.typed`, no HTTP/archive libraries or agent wrapper, and only `copilotkit_intelligence_adk` in the wheel.

- [ ] **Step 8: Commit the ADK package**

```bash
git add sdk-python-adk
git commit -m "feat: add Intelligence Google ADK adapter"
```

## Task 3: Implement the LangGraph Python package test-first

**Dependencies:** Task 0 commit for local development; Task 0 PyPI gate and Task 1 commit before merge/release.

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

Set Poetry name/version to `copilotkit-intelligence-langgraph`/`0.1.0`, Python `>=3.10`, MIT/repository metadata, and dependencies `copilotkit>=0.1.95,<1.0.0`, `langgraph>=1.2.2,<2.0.0`, and `langchain>=1.3.2,<2.0.0`. Define the `@copilotkit/intelligence-langgraph-python` Nx `test`, `check`, `build`, and `pack-check` targets with the exact commands in the common target table.

Run `cd sdk-python && poetry build && cd .. && python3.10 -m venv sdk-python-langgraph/.venv && sdk-python-langgraph/.venv/bin/pip install --upgrade pip && sdk-python-langgraph/.venv/bin/pip install sdk-python/dist/copilotkit-0.1.95-py3-none-any.whl 'langgraph>=1.2.2,<2.0.0' 'langchain>=1.3.2,<2.0.0' pytest pytest-asyncio build twine && sdk-python-langgraph/.venv/bin/pip install --no-deps -e sdk-python-langgraph && sdk-python-langgraph/.venv/bin/python -c 'from copilotkit import IntelligenceSkillDescriptor'`. Expected setup GREEN: Python 3.10+, editable adapter import, and the exact local descriptor wheel without a PyPI lookup for `copilotkit`.

- [ ] **Step 2: Verify the native middleware boundary at both floors**

In separate Python 3.10 environments, install the exact minimum pair and then newest compatible pair. The probe imports the public `AgentMiddleware` types, defines a no-op middleware using the public request hook supported by both versions, and registers it with `langchain.agents.create_agent(..., middleware=[probe])` without invoking a model. Record the exact hook signature. Do not copy private functions from `sdk-python/copilotkit/copilotkit_lg_middleware.py`.

Execute `sdk-python-langgraph/.venv/bin/pip install 'langgraph==1.2.2' 'langchain==1.3.2' && sdk-python-langgraph/.venv/bin/pytest sdk-python-langgraph/tests/api_contract/test_langgraph_contract.py::test_native_middleware_registration_contract -v && sdk-python-langgraph/.venv/bin/pip install --upgrade 'langgraph>=1.2.2,<2.0.0' 'langchain>=1.3.2,<2.0.0' && sdk-python-langgraph/.venv/bin/pytest sdk-python-langgraph/tests/api_contract/test_langgraph_contract.py::test_native_middleware_registration_contract -v`; expected GREEN is two native registrations and printed resolved versions.

- [ ] **Step 3: Write the failing public factory and lifecycle tests**

Tests import both `createSkillRegistryMiddleware` and `create_skill_registry_middleware`, assert object identity between them, assert the factory returns the verified native middleware type, blocks cold starts, throttles and singleflights refreshes, preserves model request/config fields, injects one complete ordered skill value, and refuses stale/denied/script/oversize snapshots before calling the model handler. Expected initial RED: both exports are missing.

Run `sdk-python-langgraph/.venv/bin/pytest sdk-python-langgraph/tests/test_public_api.py::test_camel_and_snake_case_exports_are_identical sdk-python-langgraph/tests/test_middleware.py::test_native_middleware_loads_before_model sdk-python-langgraph/tests/test_middleware.py::test_joined_callers_share_telemetry_sink_failure -v`; expected RED is the missing factory exports. Rerun unchanged after implementation; expected GREEN is three passing tests.

- [ ] **Step 4: Implement the minimum middleware**

Put generic lifecycle mechanics in `_registry_state.py`; it consumes only `IntelligenceSkillSet.skill_descriptors`, rejects script roles/paths before reads, and reads strict-UTF-8 root `SKILL.md` files from descriptor directories. `middleware.py` creates the verified native middleware and uses the verified model-request replacement/copy API instead of mutating caller state. Support sync and async hooks only when the minimum API provides both; async must never run blocking Registry I/O on the event loop. The factory accepts a generic client, learning-container ID, limits, refresh interval, clock, and telemetry sink; it does not accept or return an agent.

- [ ] **Step 5: Lock the naming contract**

Set `create_skill_registry_middleware = createSkillRegistryMiddleware` and include both names in `__all__`. Assert `createSkillRegistryMiddleware is create_skill_registry_middleware`, while module and README text both contain: `create_skill_registry_middleware is the Python spelling of the normative createSkillRegistryMiddleware API.` `examples/agent.py` registers the returned middleware through the verified native `create_agent` API without wrapping the agent.

- [ ] **Step 6: Run corpus, minimum/latest, and artifact checks**

Implement parameterized `test_adapter_conformance(case: dict[str, object])` and `test_readme_and_public_api_contract()`. Run all 35 shared cases under the exact minimum pair, repeat under newest compatible versions, then run `sdk-python-langgraph/.venv/bin/pytest sdk-python-langgraph/tests/test_public_api.py::test_readme_and_public_api_contract -v && pnpm nx run @copilotkit/intelligence-langgraph-python:build && pnpm nx run @copilotkit/intelligence-langgraph-python:pack-check`. Assert all ten README headings, both factory names, clean native-registration import, README/LICENSE/`py.typed`, and only `copilotkit_intelligence_langgraph`.

- [ ] **Step 7: Commit the Python LangGraph adapter**

```bash
git add sdk-python-langgraph
git commit -m "feat: add Intelligence LangGraph Python adapter"
```

## Task 4: Implement the LangGraph TypeScript package test-first

**Dependency:** Task 1 commit.

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

Use version `0.1.0`, Node engine `>=20`, MIT/repository directory metadata, public access, `dist`/README/LICENSE files, and one root ESM export. Declare peers `@copilotkit/intelligence>=0.1.0 <1.0.0`, `@langchain/langgraph>=1.3.0 <2.0.0`, and `langchain>=1.4.4 <2.0.0`; use the workspace generic SDK and exact framework minima as dev dependencies. Add package scripts `build`, `check-types`, `test`, `publint`, `attw`, and `verify-package`, then define the `@copilotkit/intelligence-langgraph` Nx `test`, `check`, `build`, and `pack-check` targets with the exact commands in the common target table.

Run `corepack enable && pnpm install --frozen-lockfile=false && node --version`; expected setup GREEN is Node 20+ and a workspace install. This slot does not stage `pnpm-lock.yaml`.

- [ ] **Step 2: Compile native minimum/latest middleware probes**

Create temporary consumers in `tests/api-contract/.tmp` through `scripts/verify-package.ts`, install the packed adapter with the exact minima and then the unpinned compatible ranges, compile a no-op public middleware registered in `createAgent({ middleware: [...] })`, and delete the temporary consumers in `finally`. Print resolved package versions and save no generated files. A compile failure blocks implementation rather than introducing `as any` or an agent wrapper.

Run `pnpm --filter @copilotkit/intelligence-langgraph verify-package --mode minimum && pnpm --filter @copilotkit/intelligence-langgraph verify-package --mode latest`. Expected GREEN: the minimum consumer resolves `@langchain/langgraph@1.3.0`/`langchain@1.4.4`, the latest consumer stays below 2.0.0, both compile native registration, and `.tmp` is absent afterward. The minimum is `1.4.4` because npm never published `langchain@1.4.3`.

- [ ] **Step 3: Write failing Vitest lifecycle tests**

With fake timers and a deferred generic client, assert cold blocking, throttle boundary, one promise for concurrent callers, ETag refresh delegation, immutable request snapshots, stale/denial refusal, revoked empty behavior, all limits, no child process use, and telemetry. Expected initial failure: `createSkillRegistryMiddleware` is undefined.

Run `pnpm vitest --config packages/intelligence-langgraph/vitest.config.ts run packages/intelligence-langgraph/src/middleware.test.ts -t "loads before the native model hook|retries after the failed throttle window|shares telemetry sink failure across joined callers|rejects loads created after close"`; expected RED is the undefined factory. Rerun unchanged after implementation; expected GREEN is four passing tests.

- [ ] **Step 4: Implement native middleware and state**

`registry-state.ts` owns the common state machine. `middleware.ts` uses only the verified public LangChain middleware constructor/factory and request-copy API, preserves all unrelated request/config/state keys, and injects the deterministic ordered native skill value. `index.ts` exports only `createSkillRegistryMiddleware` plus necessary public option/status types; it must not re-export the generic SDK. `examples/agent.ts` attaches the middleware through `createAgent({ middleware: [...] })` and is typechecked but excluded from the npm tarball.

- [ ] **Step 5: Run corpus and package verification**

Implement `describe.each(corpus.cases)("adapter conformance: $name", (case_) => ...)` and `README and public API contract > exports and documents every required behavior`, then run `pnpm nx test @copilotkit/intelligence-langgraph`, `pnpm nx run @copilotkit/intelligence-langgraph:check-types`, `pnpm nx run @copilotkit/intelligence-langgraph:build`, `pnpm --filter @copilotkit/intelligence-langgraph publint`, `pnpm --filter @copilotkit/intelligence-langgraph attw`, and `pnpm --filter @copilotkit/intelligence-langgraph verify-package`. Expected: 35 corpus cases and all ten README assertions pass, the minimum/latest consumers compile on Node 20, and the tarball contains only declared files with peer ranges unchanged.

- [ ] **Step 6: Commit the TypeScript adapter without the shared lockfile**

```bash
git add packages/intelligence-langgraph
git commit -m "feat: add Intelligence LangGraph TypeScript adapter"
```

The slot leaves `pnpm-lock.yaml` to the serialized integration task.

## Task 5: Implement the Microsoft Agent Framework Python package test-first

**Dependencies:** Task 0 commit for local development; Task 0 PyPI gate and Task 1 commit before merge/release.

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

Set Poetry name/version to `copilotkit-intelligence-agent-framework`/`0.1.0`, Python `>=3.10`, MIT/repository metadata, and dependencies `copilotkit>=0.1.95,<1.0.0` and `agent-framework-core>=1.11.0,<2.0.0`. Define the `@copilotkit/intelligence-agent-framework-python` Nx `test`, `check`, `build`, and `pack-check` targets with the exact commands in the common target table.

Run `cd sdk-python && poetry build && cd .. && python3.10 -m venv sdk-python-agent-framework/.venv && sdk-python-agent-framework/.venv/bin/pip install --upgrade pip && sdk-python-agent-framework/.venv/bin/pip install sdk-python/dist/copilotkit-0.1.95-py3-none-any.whl 'agent-framework-core>=1.11.0,<2.0.0' pytest pytest-asyncio build twine && sdk-python-agent-framework/.venv/bin/pip install --no-deps -e sdk-python-agent-framework && sdk-python-agent-framework/.venv/bin/python -c 'from copilotkit import IntelligenceSkillDescriptor'`. Expected setup GREEN: Python 3.10+, editable adapter import, and the exact local descriptor wheel without a PyPI lookup for `copilotkit`.

- [ ] **Step 2: Discover and import-test the public context-provider protocol**

Install `agent-framework-core==1.11.0`, inspect only its public exports and type information, implement a no-op provider, and register that provider through the public agent/chat-client options path without running a model. Repeat against newest compatible. Record the verified base/protocol, invocation method, context result type, and registration keyword in README and the probe assertion. The repository's preview-era `Agent` wrappers and `agent_middleware` examples are orientation only and must not be copied as the provider implementation.

Execute `sdk-python-agent-framework/.venv/bin/pip install 'agent-framework-core==1.11.0' && sdk-python-agent-framework/.venv/bin/pytest sdk-python-agent-framework/tests/api_contract/test_agent_framework_contract.py::test_native_context_provider_registration_contract -v && sdk-python-agent-framework/.venv/bin/pip install --upgrade 'agent-framework-core>=1.11.0,<2.0.0' && sdk-python-agent-framework/.venv/bin/pytest sdk-python-agent-framework/tests/api_contract/test_agent_framework_contract.py::test_native_context_provider_registration_contract -v`; expected GREEN is two native registrations and printed resolved versions.

- [ ] **Step 3: Write failing provider behavior tests**

Assert `SkillRegistryContextProvider` satisfies the verified runtime protocol, loads before context generation, returns a complete immutable ordered context block, preserves framework context already supplied by other providers, supports cancellation if the native protocol carries it, and enforces every common lifecycle/error/security case without constructing or delegating an agent.

Run `sdk-python-agent-framework/.venv/bin/pytest sdk-python-agent-framework/tests/test_context_provider.py::test_provider_loads_before_context_generation sdk-python-agent-framework/tests/test_context_provider.py::test_retry_after_failed_throttle_window sdk-python-agent-framework/tests/test_context_provider.py::test_joined_callers_share_telemetry_sink_failure sdk-python-agent-framework/tests/test_context_provider.py::test_future_load_after_close_rejects -v`; expected RED is missing `SkillRegistryContextProvider`. Rerun unchanged after implementation; expected GREEN is four passing tests.

- [ ] **Step 4: Implement the provider and state machine**

Put lifecycle code in `_registry_state.py` and the native protocol implementation in `context_provider.py`. The state consumes only `IntelligenceSkillSet.skill_descriptors`, rejects script roles/paths before reads, and reads strict-UTF-8 root `SKILL.md` files from descriptor directories. Use the exact public result types from the probe, compose rather than replace existing context, and expose constructor options for generic client, container ID, limits, refresh interval, clock, and telemetry. `__all__` contains only `SkillRegistryContextProvider` plus public option/status types needed for annotation. `examples/agent.py` uses the verified context-provider registration keyword and never defines an agent wrapper.

- [ ] **Step 5: Run corpus, boundaries, and package checks**

Implement parameterized `test_adapter_conformance(case: dict[str, object])` and `test_readme_and_public_api_contract()`, run all 35 corpus cases at `agent-framework-core==1.11.0` and newest compatible, then run `sdk-python-agent-framework/.venv/bin/pytest sdk-python-agent-framework/tests/test_public_api.py::test_readme_and_public_api_contract -v && pnpm nx run @copilotkit/intelligence-agent-framework-python:build && pnpm nx run @copilotkit/intelligence-agent-framework-python:pack-check`. Expected GREEN includes all ten README headings, a native registration smoke import, and only the declared package in the wheel.

- [ ] **Step 6: Commit the Python Agent Framework adapter**

```bash
git add sdk-python-agent-framework
git commit -m "feat: add Intelligence Agent Framework Python adapter"
```

## Task 6: Implement the Microsoft Agent Framework .NET package test-first

**Dependency:** Task 1 commit.

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
- Create: `sdk-dotnet-agent-framework/scripts/verify-api-contract.sh`
- Create: `sdk-dotnet-agent-framework/scripts/verify-package.sh`
- Create: `sdk-dotnet-agent-framework/README.md`
- Create: `sdk-dotnet-agent-framework/project.json`

- [ ] **Step 1: Scaffold the independent NuGet project**

Target `net8.0`, enable nullable/implicit usings/XML docs/warnings-as-errors/deterministic build/portable symbols, set PackageId/version `CopilotKit.Intelligence.AgentFramework`/`0.1.0`, MIT/repository/readme metadata, and reference `Microsoft.Agents.AI.Abstractions` `[1.13.0,2.0.0)` plus `CopilotKit.Intelligence` `[0.1.0,1.0.0)`. Use a `UseLocalIntelligenceSdk=true` condition to replace only the latter PackageReference with a ProjectReference during repository tests; pack with the package dependency and assert it in `.nuspec`.

Define the `@copilotkit/intelligence-agent-framework-dotnet` Nx `test`, `check`, `build`, and `pack-check` targets with the exact commands in the common target table. `scripts/verify-package.sh` runs the Task 6 pack, `.nuspec`, symbol-package, and clean-consumer assertions and fails on the first mismatch.

Run `dotnet --version && dotnet restore sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/CopilotKit.Intelligence.AgentFramework.Tests.csproj -p:UseLocalIntelligenceSdk=true`; expected setup GREEN is .NET SDK 8+ and a successful repository restore.

- [ ] **Step 2: Compile the native provider contract at minimum/latest**

Generate two temporary `Directory.Packages.props` files, restore once with exactly `1.13.0` and once with the newest `<2.0.0`, and compile a no-op provider registered through the public Agent Framework context-provider API. Record the verified public interface/base, async method, result type, registration method, and cancellation token position in `ApiContractTests.cs` and README. Do not use the repository's `DelegatingAIAgent` examples as the implementation.

`verify-api-contract.sh` resolves the newest stable `Microsoft.Agents.AI.Abstractions` version below 2.0.0, writes the selected exact version to its temporary props file, prints it, runs the filtered xUnit probe, and removes the props file in a trap. Run `bash sdk-dotnet-agent-framework/scripts/verify-api-contract.sh minimum` and `bash sdk-dotnet-agent-framework/scripts/verify-api-contract.sh latest`. Expected GREEN: minimum prints `1.13.0`, latest prints a stable version `>=1.13.0` and `<2.0.0`, and both compile the same native registration.

- [ ] **Step 3: Write failing lifecycle and native-provider tests**

Use xUnit, a fake `TimeProvider`, `TaskCompletionSource`, and fake `IntelligenceClient` seam. Assert cold blocking, throttle, singleflight, snapshot atomicity, existing-context composition, cancellation, stale/denial/revoked behavior, limits, script denial, telemetry, disposal, and that `SkillRegistryContextProvider` is assignable to the verified native provider abstraction. Expected initial failure: type not found.

Run `dotnet test sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/CopilotKit.Intelligence.AgentFramework.Tests.csproj -p:UseLocalIntelligenceSdk=true --filter "FullyQualifiedName~LoadsBeforeNativeContext|FullyQualifiedName~RetriesAfterFailedThrottleWindow|FullyQualifiedName~JoinedCallersShareTelemetrySinkFailure|FullyQualifiedName~FutureLoadAfterDisposeRejects"`; expected RED is the missing type. Rerun unchanged after implementation; expected GREEN is four passing tests.

- [ ] **Step 4: Implement the provider without duplicating the SDK**

`RegistryState.cs` calls only `IntelligenceClient.GetAsync` and `GetCachedAsync`, consumes the generic .NET SDK's verified public installed-skill records (never cache metadata), checks verified manifest roles/paths before reading `SKILL.md`, and atomically exchanges one immutable snapshot. `SkillRegistryContextProvider.cs` implements only the verified provider contract, composes native context, propagates cancellation and `IntelligenceSdkException`, and implements idempotent async disposal if required by the native abstraction.

- [ ] **Step 5: Run corpus and pack checks**

Implement `ConformanceCases` returning all 35 named data rows and `ReadmeAndPublicApiContract`. Run `pnpm nx test @copilotkit/intelligence-agent-framework-dotnet`, the minimum/latest restore matrix, and `dotnet test sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework.Tests/CopilotKit.Intelligence.AgentFramework.Tests.csproj -p:UseLocalIntelligenceSdk=true --filter "FullyQualifiedName~ReadmeAndPublicApiContract"`. Then run `dotnet pack sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework/CopilotKit.Intelligence.AgentFramework.csproj -c Release --include-symbols -o sdk-dotnet-agent-framework/artifacts`, `unzip -p sdk-dotnet-agent-framework/artifacts/CopilotKit.Intelligence.AgentFramework.0.1.0.nupkg CopilotKit.Intelligence.AgentFramework.nuspec`, and `dotnet build sdk-dotnet-agent-framework/examples/Example.csproj -p:AdapterPackagePath=sdk-dotnet-agent-framework/artifacts/CopilotKit.Intelligence.AgentFramework.0.1.0.nupkg`. Expected GREEN: exactly one `.nupkg`/`.snupkg`, exact dependency ranges, all ten README headings, and the clean net8.0 native-provider consumer compiles.

- [ ] **Step 6: Commit the .NET Agent Framework adapter**

```bash
git add sdk-dotnet-agent-framework
git commit -m "feat: add Intelligence Agent Framework .NET adapter"
```

## Task 7: Integrate workspace lockfile and cross-package CI

**Files:**

- Modify: `pnpm-lock.yaml`
- Create: `packages/intelligence/conformance/adapter-ci-matrix-v1.json`
- Create: `packages/intelligence/src/adapter-ci-matrix.test.ts`
- Create: `.github/workflows/test-intelligence-adapters.yml`

- [ ] **Step 0: Install the integrated workspace**

Run `corepack enable && pnpm install --frozen-lockfile=false && node --version`. Expected setup GREEN: Node 20+ and all six new workspace projects are discovered before the single lockfile regeneration.

- [ ] **Step 1: Regenerate only the shared lockfile after all package roots exist**

Run `pnpm install --lockfile-only`. Review `git diff -- pnpm-lock.yaml` and require entries for `packages/intelligence-langgraph` with the declared peer ranges; reject unrelated dependency upgrades.

- [ ] **Step 2: Add the failing CI workflow structure test**

Create `adapter-ci-matrix-v1.json` with exactly the Cartesian product of `adk-python`, `langgraph-python`, `langgraph-typescript`, `agent-framework-python`, and `agent-framework-dotnet` with `minimum` and `latest`. Add repository test `adapter CI matrix > declares and consumes exactly ten minimum/latest cells`; it asserts ten unique cells, exact equality with that product, exact lower-bound strings in the five minimum cells, exclusive-major strings in latest cells, and that `test-intelligence-adapters.yml` obtains its strategy matrix from this checked-in JSON rather than a second hand-maintained list.

Run `pnpm nx test @copilotkit/intelligence -- --run src/adapter-ci-matrix.test.ts`. Expected RED: the matrix JSON/workflow is absent.

- [ ] **Step 3: Implement the matrix jobs**

Path filters include all five package roots, three generic SDK roots, the shared corpus, the workflow, and dependency lockfiles. A `matrix` job reads the JSON with `jq -c '{include: .cells}'` into a job output; the test job uses `strategy.matrix: ${{ fromJSON(needs.matrix.outputs.adapter_matrix) }}`. Every cell checks out without persisted credentials, installs the declared runtime floor/range, prints resolved versions, runs its Nx target and corpus runner, and uploads dependency/version plus test reports. Set `fail-fast: false`; no cell has registry write credentials.

Before any Python matrix cell invokes Nx, build the prerequisite once with `cd sdk-python && poetry build && cd ..`. The three Python cells use these exact local-install commands, substituting only their minimum/latest framework range from the checked-in matrix:

```bash
python3.10 -m venv "${ADAPTER_ROOT}/.venv"
mapfile -t FRAMEWORK_ARGS < <(jq -r '.[]' <<< '${{ toJSON(matrix.frameworkRequirements) }}')
"${ADAPTER_ROOT}/.venv/bin/pip" install sdk-python/dist/copilotkit-0.1.95-py3-none-any.whl pytest pytest-asyncio build twine "${FRAMEWORK_ARGS[@]}"
"${ADAPTER_ROOT}/.venv/bin/pip" install --no-deps -e "${ADAPTER_ROOT}"
"${ADAPTER_ROOT}/.venv/bin/python" -c 'from copilotkit import IntelligenceSkillDescriptor'
```

The matrix provides a concrete `ADAPTER_ROOT` string and `frameworkRequirements` JSON array for each cell; the workflow passes the root through `env` and converts the JSON array with `jq` into quoted Bash array elements. Minimum cells use the exact lower bounds; latest cells use the bounded requirements. This local wheel path is required in PR CI even after 0.1.95 is public, so a yanked/mirrored PyPI state cannot change the code under test.

Rerun `pnpm nx test @copilotkit/intelligence -- --run src/adapter-ci-matrix.test.ts`. Expected GREEN: one test proves the real workflow consumes all ten and only ten cells.

- [ ] **Step 4: Add artifact smoke jobs**

Build all three Python distributions, the npm tarball, and NuGet packages. Verify contents and compile/import clean consumers. Run generic SDK tests first through Nx, proving adapters did not change their identities or APIs.

- [ ] **Step 5: Run workflow lint and local matrices available on the host**

Run `pnpm nx test @copilotkit/intelligence`, `pnpm nx run-many --targets=test,check,build,pack-check --projects=@copilotkit/intelligence-adk,@copilotkit/intelligence-langgraph-python,@copilotkit/intelligence-langgraph,@copilotkit/intelligence-agent-framework-python,@copilotkit/intelligence-agent-framework-dotnet`, `pnpm check-format`, `actionlint .github/workflows/test-intelligence-adapters.yml`, and `bash scripts/release/verify-release-scope-dropdowns.sh`. Expected: all 20 named adapter targets PASS; unavailable host runtimes are exercised by CI rather than silently skipped.

- [ ] **Step 6: Commit integration CI**

```bash
git add pnpm-lock.yaml packages/intelligence/conformance/adapter-ci-matrix-v1.json packages/intelligence/src/adapter-ci-matrix.test.ts .github/workflows/test-intelligence-adapters.yml
git commit -m "ci: test Intelligence adapters at support boundaries"
```

## Task 8: Add independent release lanes and ownership

**Files:**

- Modify: `release.config.json`
- Modify: `.github/CODEOWNERS`
- Modify: `.github/workflows/publish-release.yml`
- Modify: `.github/workflows/stable-release.yml`
- Modify: `.github/workflows/canary.yml`
- Modify: `.github/workflows/lint-release-workflows.yml`
- Create: `scripts/release/detect-intelligence-adapter-version-changes.ts`
- Create: `scripts/release/detect-intelligence-adapter-version-changes.test.ts`
- Create: `scripts/release/fixtures/intelligence-adapters-unpublished.json`
- Modify: `scripts/release/lib/config.ts`
- Modify: `scripts/release/lib/config.test.ts`
- Modify: `scripts/release/lib/changes.test.ts`
- Modify: `scripts/release/lib/versions.test.ts`
- Modify: `scripts/release/lib/build-release-notification.ts`
- Modify: `scripts/release/lib/build-release-notification.wrapper.test.ts`
- Modify: `scripts/release/verify-release-scope-dropdowns.sh`

- [ ] **Step 0: Establish the release-test environment**

Run `corepack enable && pnpm install --frozen-lockfile && pnpm tsx --version && git status --short`. Expected setup GREEN: the locked workspace installs, `tsx` is local, and the only changes are the already reviewed Task 0-7 commits.

- [ ] **Step 1: Write failing release configuration tests**

Extend the closed `ReleaseScope` union in `scripts/release/lib/config.ts` with `"intelligence-langgraph"`. In `config.test.ts`, add `Intelligence LangGraph release scope > is an independent one-package scope` asserting `{ packages: ["@copilotkit/intelligence-langgraph"], versionSource: "@copilotkit/intelligence-langgraph", sharedVersion: false }`. In `changes.test.ts`, add `Intelligence LangGraph release history > uses intelligence-langgraph/v* as its independent tag boundary`. In `versions.test.ts`, add the scope to the mock config and tests `resolves only the Intelligence LangGraph package` and `bumps Intelligence LangGraph without mutating monorepo, angular, or channels packages`. In `build-release-notification.wrapper.test.ts`, extend the named positive-count assertions with `resolvePackageCountSafe("intelligence-langgraph") === 1`; retain the existing `EVERY scope in release.config.json` anti-drift test. Add detector tests mapping all five exact manifests to package ID, registry, version, directory, tag prefix, and distinct concurrency key.

Run `pnpm vitest --config scripts/release/vitest.config.mts run scripts/release/lib/config.test.ts scripts/release/lib/changes.test.ts scripts/release/lib/versions.test.ts scripts/release/lib/build-release-notification.wrapper.test.ts scripts/release/detect-intelligence-adapter-version-changes.test.ts`. Expected RED: the closed union/config lacks `intelligence-langgraph` and detector module is absent.

- [ ] **Step 2: Add exact ownership entries**

Resolve the Intelligence/Learning team slug with the command in “Repository layout and file ownership,” require one result, then add all five package roots, the shared adapter corpus, adapter CI, and adapter release detector to that team in `.github/CODEOWNERS` while preserving global owners.

- [ ] **Step 3: Implement fail-loud version detection**

The detector accepts one of the five package IDs, reads only its manifest, validates stable SemVer, queries only its registry, emits `should_publish`, `name`, `version`, `directory`, and `tag_prefix`, returns false only when the exact version already exists, and throws on authentication, transport, malformed response, or a published newer version.

- [ ] **Step 4: Add independent build/publish jobs**

Extend `publish-release.yml` without changing existing generic SDK lanes. Add job `python-adapter-sdk-gate`, with no publish credential, that retries the exact PyPI JSON for `copilotkit/0.1.95` for 30 ten-second attempts, creates a temporary Python 3.10 venv, installs `copilotkit==0.1.95` with `--no-cache-dir`, and imports all three descriptor types. Each of the three separately named Python adapter build jobs declares `needs: [python-adapter-sdk-gate]`; after that gate they have no `needs` edge to one another. Before test/build/inspection, their release environments prove normal index resolution with these exact commands:

The gate's executable probe is:

```bash
for attempt in $(seq 1 30); do
  curl -fsS https://pypi.org/pypi/copilotkit/0.1.95/json >/dev/null && break
  test "$attempt" -lt 30
  sleep 10
done
python3.10 -m venv /tmp/copilotkit-intelligence-adapter-release-gate
/tmp/copilotkit-intelligence-adapter-release-gate/bin/pip install --no-cache-dir copilotkit==0.1.95
/tmp/copilotkit-intelligence-adapter-release-gate/bin/python -c 'from copilotkit import IntelligenceSkillDescriptor, IntelligenceSkillManifestDescriptor, IntelligenceSkillFileDescriptor'
```

Before test/build/inspection, the three adapter release environments prove normal index resolution with these exact commands:

```bash
python3.10 -m venv sdk-python-adk/.venv-release
sdk-python-adk/.venv-release/bin/pip install --no-cache-dir 'copilotkit==0.1.95' 'google-adk>=2.0.0,<3.0.0' pytest pytest-asyncio build twine
sdk-python-adk/.venv-release/bin/pip install --no-deps -e sdk-python-adk

python3.10 -m venv sdk-python-langgraph/.venv-release
sdk-python-langgraph/.venv-release/bin/pip install --no-cache-dir 'copilotkit==0.1.95' 'langgraph>=1.2.2,<2.0.0' 'langchain>=1.3.2,<2.0.0' pytest pytest-asyncio build twine
sdk-python-langgraph/.venv-release/bin/pip install --no-deps -e sdk-python-langgraph

python3.10 -m venv sdk-python-agent-framework/.venv-release
sdk-python-agent-framework/.venv-release/bin/pip install --no-cache-dir 'copilotkit==0.1.95' 'agent-framework-core>=1.11.0,<2.0.0' pytest pytest-asyncio build twine
sdk-python-agent-framework/.venv-release/bin/pip install --no-deps -e sdk-python-agent-framework
```

The three PyPI entries, one npm scope, and one NuGet entry each detect their own manifest change, use a package-specific concurrency group, publish idempotently, verify registry visibility, and tag only that package.

Add `intelligence-langgraph` to the `workflow_dispatch.inputs.scope.options` lists in `stable-release.yml`, `publish-release.yml`, and `canary.yml`; update the scope comment in `build-release-notification.ts`. The existing dynamic validation in `prepare-release.ts`, `bump-prerelease.ts`, `prerelease.ts`, and `publish-release.ts` must accept the new config key without source changes.

- [ ] **Step 5: Update trusted-publisher documentation and workflow allowlists**

Document the exact workflow filename, environment, and package identity for each PyPI/npm trusted publisher next to the publish job. Add all five adapter manifests/roots, `test-intelligence-adapters.yml`, the detector, and every modified release file to both path-filter lists and the actionlint file list in `lint-release-workflows.yml`. Keep `verify-release-scope-dropdowns.sh` as the fail-loud dropdown guard and update its fixture/self-check to expect `intelligence-langgraph` in all three workflow dropdowns. NuGet continues to use the scoped secret only at push time.

- [ ] **Step 6: Run release dry-runs and detector tests**

Run the GREEN unit command from Step 1, then `bash scripts/release/verify-release-scope-dropdowns.sh`, `actionlint .github/workflows/stable-release.yml .github/workflows/publish-release.yml .github/workflows/canary.yml .github/workflows/lint-release-workflows.yml`, `pnpm tsx scripts/release/prepare-release.ts --bump patch --scope intelligence-langgraph --dry-run`, and `pnpm tsx scripts/release/prerelease.ts --scope intelligence-langgraph --dry-run`. Run detector-only local dry-runs with `pnpm tsx scripts/release/detect-intelligence-adapter-version-changes.ts --package copilotkit-intelligence-adk --registry-fixture scripts/release/fixtures/intelligence-adapters-unpublished.json --dry-run` and the same command for `copilotkit-intelligence-langgraph`, `@copilotkit/intelligence-langgraph`, `copilotkit-intelligence-agent-framework`, and `CopilotKit.Intelligence.AgentFramework`. After merge, validate the stable publish consumer with `gh workflow run publish-release.yml --ref main -f scope=intelligence-langgraph -f mode=stable -f dry-run=true`. Expected GREEN: all scope consumers accept the new scope, the dropdown guard passes, five separate detector summaries and the workflow dry-run publish/tag nothing, and `git diff -- sdk-python/pyproject.toml sdk-dotnet/CopilotKit.Intelligence/CopilotKit.Intelligence.csproj packages/intelligence/package.json` is empty.

- [ ] **Step 7: Commit the serialized release boundary**

```bash
git add release.config.json .github/CODEOWNERS .github/workflows/publish-release.yml .github/workflows/stable-release.yml .github/workflows/canary.yml .github/workflows/lint-release-workflows.yml scripts/release/detect-intelligence-adapter-version-changes.ts scripts/release/detect-intelligence-adapter-version-changes.test.ts scripts/release/fixtures/intelligence-adapters-unpublished.json scripts/release/lib/config.ts scripts/release/lib/config.test.ts scripts/release/lib/changes.test.ts scripts/release/lib/versions.test.ts scripts/release/lib/build-release-notification.ts scripts/release/lib/build-release-notification.wrapper.test.ts scripts/release/verify-release-scope-dropdowns.sh
git commit -m "ci: release Intelligence adapters independently"
```

## Task 9: Final cross-package verification and integration order

Integration order is fixed: merge the generic Python descriptor prerequisite PR; wait for the exact 0.1.95 PyPI install/import gate; merge the shared corpus; land the five file-disjoint adapter commits in any order; then land lockfile/CI and release/ownership. The three Python adapters may be developed against the local wheel before PyPI visibility, but cannot merge or enter artifact release builds until the gate passes. If a package slot needs a corpus change, it reports the missing scenario and waits for the serialized owner; it does not edit the corpus itself. If two slots discover incompatible framework semantics, preserve the common observable contract and isolate the difference inside their native hook.

- [ ] **Step 1: Verify exact public names and dependency bounds**

Run `rg -n 'copilotkit-intelligence-adk|copilotkit-intelligence-langgraph|@copilotkit/intelligence-langgraph|copilotkit-intelligence-agent-framework|CopilotKit.Intelligence.AgentFramework|createSkillRegistryMiddleware|create_skill_registry_middleware|SkillRegistryContextProvider|SkillRegistry|SkillToolset' sdk-python-adk sdk-python-langgraph packages/intelligence-langgraph sdk-python-agent-framework sdk-dotnet-agent-framework`. Assert both Python LangGraph names export the same object, all exclusive next-major bounds are exact, Python/Node/net8 floors are present, and no adapter declares a runtime dependency on another adapter.

- [ ] **Step 2: Verify generic SDK preservation and no duplicate HTTP**

Run `pnpm nx test @copilotkit/intelligence`, `cd sdk-python && poetry run pytest tests/test_intelligence.py -v`, and `dotnet test sdk-dotnet/CopilotKit.Intelligence.Tests/CopilotKit.Intelligence.Tests.csproj`; return to the root after the Python command. Then run `rg -n 'fetch\(|urlopen|HttpClient|/v1/learning-containers|\.copilotkit-current|ZipArchive|zipfile|sha256' sdk-python-adk/src sdk-python-langgraph/src packages/intelligence-langgraph/src sdk-python-agent-framework/src sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework`. Expected: generic suites pass and the search has no duplicate HTTP/cache/archive verification implementation.

- [ ] **Step 3: Run the complete test/build/package matrix**

Run `pnpm nx test @copilotkit/intelligence -- --run src/adapter-conformance.test.ts src/adapter-ci-matrix.test.ts`, `pnpm --filter @copilotkit/intelligence verify:adapter-conformance`, and `pnpm nx run-many --targets=test,check,build,pack-check --projects=@copilotkit/intelligence-adk,@copilotkit/intelligence-langgraph-python,@copilotkit/intelligence-langgraph,@copilotkit/intelligence-agent-framework-python,@copilotkit/intelligence-agent-framework-dotnet`. Run the minimum/latest commands recorded in each task and the release `python-adapter-sdk-gate` probe. Expected: `35 adapter conformance cases valid`, exactly ten compatibility cells, all 20 explicitly defined Nx targets pass, `copilotkit==0.1.95` imports from PyPI for release, and resolved versions are captured in the final CI summary.

- [ ] **Step 4: Inspect state/failure acceptance tests**

Require every adapter's 35-row runner plus its named native lifecycle tests to pass. This explicitly covers load/preload/readiness success/timeout/immediate rejection, atomic memory and disk delegation, throttle/singleflight/ETag, retry after failed window, stale/denial/cold start, all ten permanent denial classifications, size/script limits, telemetry sink failure with joined callers, cancellation/disposal, future load rejection after close, empty/revoked, and generic canonical error propagation.

- [ ] **Step 5: Inspect release and ownership acceptance tests**

Require five independent versions, concurrency keys, tags, artifact inspections, and registry checks; exact Intelligence/Learning CODEOWNERS coverage; minimum/latest CI; and no shared release version mutation.

- [ ] **Step 6: Final repository checks**

Run `pnpm check-format`, `git diff --check`, `rg -n 'TBD|TODO|implement later' dev-docs/architecture/intelligence-adapters-plan.md`, and `git status --short`. Expected: formatter and diff checks pass, the placeholder search returns no matches, only planned files changed, no generated temporary consumers/build artifacts remain, and all owned changes are committed.

- [ ] **Step 7: Record final evidence without an ambiguous catch-all commit**

Attach the ten-cell workflow summary, five `35/35` runner results, package inspection output, release dry-run summaries, `git diff --check`, and clean `git status --short` to the implementation PR. Any correction is made and recommitted in its owning Task 0-8 boundary; no literal placeholder staging command or cross-owner catch-all commit is allowed.

Do not squash package boundaries: the shared corpus, each adapter, CI integration, and release integration remain independently reviewable commits.
