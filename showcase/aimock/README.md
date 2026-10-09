# Showcase aimock

Tagline: aimock fixture-directory layout, context-routing semantics, schema
validation, drift-risk surface, and the manual add/update fixture flow. For
service reconstruction (Railway image / startCommand / fixture URLs) see
[`./RAILWAY.md`](./RAILWAY.md). For matcher semantics / fixture-authoring
gotchas (sequenceIndex, hasToolResult, context mirroring) see
[`../GOTCHAS.md`](../GOTCHAS.md).

Deterministic LLM fixture server for showcase E2E testing. Replaces real LLM API calls (OpenAI, Anthropic, Gemini) with pre-recorded responses so Playwright tests can run PR-gated in CI without API keys and without rate limits or non-determinism.

Railway pulls [`ghcr.io/copilotkit/aimock:latest`](https://github.com/orgs/CopilotKit/packages/container/package/aimock) directly (no wrapper image). The fixtures in this directory are loaded at boot via GitHub raw URLs configured in the Railway service's `startCommand`.

## What aimock is

aimock ([`@copilotkit/aimock`](https://www.npmjs.com/package/@copilotkit/aimock)) is a general-purpose LLM mock server. It speaks the OpenAI, Anthropic, and Gemini REST shapes (including SSE streaming), loads fixtures from disk at startup, and responds to incoming chat completions by matching the user's message text against fixture `match` criteria.

The showcase deployment runs aimock in proxy mode — `--proxy-only` with real upstream URLs configured for each provider. Unmatched requests are forwarded to the real API; matched requests short-circuit with the fixture response. This makes the sidecar safe to deploy as a general-purpose smoke-test aid: tests that hit fixture-matched prompts get deterministic responses, and anything else just falls through.

## Directory Structure

```
showcase/aimock/
  shared/              Fixtures loaded by ALL integrations (smoke, universal prompts)
  d4/                  D4-depth fixtures — per-integration, single-demo coverage
    <slug>/            One directory per integration slug (e.g. langgraph-python/)
  d6/                  D6-depth fixtures — per-integration, all-pills coverage
    <slug>/            One directory per integration slug
  feature-parity.json  Legacy flat fixture file (pre-context-routing)
  smoke.json           Minimal smoke fixture
  README.md            This file
```

**Context routing.** D4 and D6 fixtures use aimock's `--context-field` flag to scope fixture matching by integration. Each integration's dev server passes its slug as the `context` value in LLM requests (via `X-AIMock-Context` header or request body field). Aimock only considers fixtures whose `match.context` equals the incoming context value, so `d4/langgraph-python/` fixtures never interfere with `d4/mastra/` fixtures even if they share the same `userMessage` pattern.

**Per-integration isolation.** Every `<slug>/` directory contains fixtures specific to that integration. This prevents cross-contamination: if `mastra` needs a different tool name than `langgraph-python` for the same demo, each has its own fixture file. The `shared/` directory holds fixtures that apply regardless of context (e.g., smoke checks, universal greeting prompts).

## Fixtures in this directory

- **`feature-parity.json`** — 35+ fixtures covering the nine showcase demos across 17 packages: agentic chat (weather, backgrounds, themes), tool rendering (pie/bar charts, weather cards), HITL (plans, steps, approvals), Sales Dashboard (deals, pipelines, todos), and assorted meeting/flight/greeting prompts. Consumed by the per-package `test_e2e-showcase-on-demand` Playwright suites and loaded at Railway boot via GitHub raw URL.
- **`smoke.json`** — a single minimal fixture (`userMessage: "Respond with exactly: OK"` → `content: "OK"`). Used by `/api/smoke` endpoints in each package to verify the aimock → package → UI round-trip without depending on a real agent.

Fixture match semantics: `userMessage` is a substring match against the last user turn. First fixture to match wins, so more specific prompts should appear before more generic ones (see the `"Based on the following context, write a concise"` entry that precedes the generic `report` / `plan` fixtures to protect CrewAI's startup probe).

## Sync policy

**Fixtures are hand-maintained.** There is no automated capture, no scheduled re-recording, and no drift-detection job that compares fixture responses against what a real LLM would say. The authoritative behavior is whatever is checked in.

The safety net is two-layered load-time validation, not behavioral verification:

1. **Load-time schema validation** (`--validate-on-load` in the Railway `startCommand` and in every test entrypoint that boots aimock) — the container refuses to start if any fixture uses an unrecognized response key (e.g. `text` instead of `content`). See [#3973](https://github.com/CopilotKit/CopilotKit/pull/3973).
2. **CI schema validation** (`showcase/scripts/__tests__/aimock-fixtures.test.ts`) — the `showcase_validate` workflow runs `loadFixtureFile` + `validateFixtures` from `@copilotkit/aimock` against every `showcase/aimock/*.json` on every PR. A broken fixture fails the PR before merge.

Neither layer catches **behavioral drift** — if a package's agent code changes what it asks the LLM (new prompt, new tool, renamed tool), the existing fixture keeps matching and keeps returning the old response. The test either keeps passing (wrong assertion) or fails at the UI-assertion layer (missing tool call, missing text), and a human has to trace it back to the fixture.

## Adding or updating a fixture

The process is manual. There is no CLI for this directory specifically — aimock's upstream `--record` mode can proxy real API calls and write fixtures, but the showcase repo does not wire it up and does not commit recorded fixtures.

1. Identify the user prompt your test issues and decide what response you need (plain text, a tool call, an error).
2. Add an entry to `feature-parity.json` under `fixtures`. Keep more specific `userMessage` matches above more generic ones. Valid response keys: `content`, `toolCalls`, `error`, `embedding`.
3. Run the fixture-validation suite locally:
   ```
   pnpm --filter @copilotkit/showcase-scripts test aimock-fixtures
   ```
4. Run the per-package E2E against the new fixture:
   ```
   ./showcase/scripts/run-e2e-with-aimock.sh <slug> [test-filter]
   ```
5. Ship it. Fixture changes take effect on the next Railway service restart (aimock fetches fixtures from GitHub raw URLs at boot).

When a package's agent code changes in a way that changes its LLM calls, the person making the change is responsible for updating the corresponding fixture. There is no automation to remind you.

### Refresh D4: capture the canonical once, then mirror — drain the journal during capture

"Refresh D4" is **not** per-integration recording. Recording each integration's
own live traffic launders that integration's request-side bugs into a
forever-green fixture (the matcher keys mainly on `userMessage` + `context`, not
the system prompt or tool schema), so a buggy prompt or wrong tool name replays
green. The canonical model — see `showcase/GOTCHAS.md` ("MIRROR the canonical
(langgraph-python) fixtures — never re-record per-integration") — is:

1. **Capture / verify the canonical live flow ONCE.** `langgraph-python` is the
   canonical reference. Boot aimock with `--record` against the real provider (as
   `docker-compose.record.yml` does), drive the D4 cell on langgraph-python, and
   capture its live tool-calling flow. **This is the only step that proxies
   upstream, so this is where the journal-drain barrier applies (see below).**
2. **Normalize the canonical fixture** — hand-clean the captured turns into the
   canonical `d4/langgraph-python/<cell>.json` shape.
3. **Mirror across integrations**, copying the canonical fixture to each
   integration and re-keying `match.context` to the integration slug (never
   re-recording per integration). This forces every integration onto one shared
   contract.
4. **Run fresh replay validation** across the mirrored integrations.

The journal-drain step belongs to **step 1 only**. During the canonical capture
there is a **capture race**:

> A probe (or your manual click-through) marks the cell satisfied as soon as the
> tool card meets the assertion, but the **POST-tool-result LLM turn can still be
> draining** — aimock is still proxying upstream and writing that fixture — after
> the driving process exits. If you move/commit the captured fixture or restart
> aimock at that instant, the late fixture lands in the wrong place (or is lost),
> and the cell can go red on replay for a turn that was never captured.

So, after driving the canonical cell and **before** normalizing/committing the
captured fixture or restarting aimock, **wait for the request journal to drain**.
aimock exposes the journal at `GET /__aimock/journal`. The **only** sound
"fully-drained" signal is the record path: aimock appends a
`response.source === "proxy"` entry **after** it has awaited the entire upstream
stream and written the fixture to disk. A replay entry (`response.status === 200`
with `response.fixture` set, `response.source` unset) is appended at stream
**start**, so it means "replay matched," **not** "fully drained" — never treat
`fixture != null` as a completion signal. Since capture runs aimock in `--record`
mode, every genuine upstream turn is a `source === "proxy"` entry.

Use the shared barrier rather than re-deriving this rule:
[`showcase/scripts/lib/journal-drain.mjs`](../scripts/lib/journal-drain.mjs)
exports `waitForJournalDrain({ expectedTurns })`, which polls the journal until
the drained (`source:"proxy"`) turn count has reached a **required** real
`expectedTurns` **and** held steady through a quiescence window. `expectedTurns`
is mandatory — quiescence alone can settle prematurely between turns while a slow
final turn is still in flight (invisible in the journal until it lands). The D5
recorder ([`record-d5-fixtures.mjs`](../scripts/record-d5-fixtures.mjs)) calls it
automatically between the probe and fixture consolidation, aborting the run if
the journal does not drain; a hand-run canonical capture must call the same
barrier (or poll the same endpoint by hand, gating on `source === "proxy"`) at
the equivalent point.

## Drift risk

Drift surfaces as **flaky or silently-wrong E2E tests**, not as a dedicated signal. Symptoms and how to respond:

- **Playwright assertion fails** on a UI element that depends on a tool call (`WeatherCard` missing, chart not rendering) → the agent is now calling a differently-named tool than the fixture has; update the fixture's `toolCalls[].name` / `arguments`.
- **Assertion on assistant text fails** → the agent's prompt changed; either update the fixture's `match.userMessage` to the new prompt substring or update the fixture's `content`.
- **`smoke.json` healthcheck fails** against a deployed package (`/api/smoke` returns non-OK) → either the package's smoke route changed or aimock is down; check the Railway service and the smoke-monitor workflow.
- **Container fails to start post-deploy** → load-time validation caught a broken fixture; CI should have caught it first, investigate why it didn't.

There is no scheduled drift-detection job that compares fixture responses against live LLM output. If this becomes a problem, the path forward is to wire aimock's `--record` mode into a periodic workflow that re-captures against real providers and diffs against checked-in fixtures — but that's not built today.

## Related workflows

- **`test_e2e-showcase-on-demand.yml`** (historically `showcase_aimock-e2e.yml`) — triggered by `/test-aimock <slug>` PR comments or `workflow_dispatch`. Installs `@copilotkit/aimock@latest`, boots it with `feature-parity.json`, spins up the target package's dev server against `OPENAI_BASE_URL=http://localhost:4010/v1`, and runs the package's Playwright suite. Posts pass/fail back to the PR.
- **`showcase_validate.yml`** — runs fixture schema validation (`aimock-fixtures.test.ts`) on every PR that touches `showcase/**`.
- **`showcase_deploy.yml`** — builds and deploys all showcase services. aimock is no longer in this workflow's matrix (Railway pulls the upstream `ghcr.io/copilotkit/aimock:latest` image directly).
- **`showcase_smoke-monitor.yml`** — every 15 minutes, polls `/api/smoke` on all deployed showcase packages. Those smoke endpoints internally hit aimock's `smoke.json` fixture to verify the full stack.
