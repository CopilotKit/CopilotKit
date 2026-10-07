# Built-in Agent: requalification on published CopilotKit 1.77.0, AG-UI 1.0 and @tanstack/ai 0.64.1 (2026-10-06)

**Verdict: qualified on unpatched published CopilotKit 1.77.0.**

- **Phase 1** (`@tanstack/ai` 0.35.0): **37 of 38** published checks pass, 37 of 39 raw. `gen-ui-agent` fails because of an upstream `@tanstack/openai-base` 0.9.2 defect. The thread-ID check is still unshipped.
- **Phase 2** (`@tanstack/ai` 0.64.1 and `@tanstack/ai-openai` 0.26.0, `f73f47038a`): **38 of 38** published checks pass, 38 of 39 raw. Only the unshipped thread-ID check fails.
- **Against 09-13.** The last result was 38/39 raw and 38/38 published, but it needed a local core patch. Phase 2 matches it with no patch.

Every AIMock request in all four full runs returned 200 or, for the thread-ID check, a strict 503. All 602 requests carry `x-aimock-context`, `x-aimock-strict` and `x-test-id`.

The work found and fixed six defects in Built-in Agent code, plus the stale page behind the `shared-state-read` failure. Every fix has red/green evidence. None changed a shared source except `sync-shared-frontends.ts`, which now fans the shared recipe page out to the Built-in Agent; no other integration changes.

|                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 first run (raw / published) | **37/39 / 37/38** at `3538cc3ac1`. Failing: `gen-ui-agent` (surface-missing, "Stopped at step 1 of 3") and the unshipped `threadid-frontend-tool-roundtrip` (12 × strict 503). Each failed both driver attempts and one separate rerun.                                                                                                                                                                                                |
| Phase 1 final run                   | **37/39 / 37/38** at `8f6aa03851`, after the fixes below. The same two checks fail.                                                                                                                                                                                                                                                                                                                                                    |
| Phase 2 first run                   | **36/39 / 36/38** on the uncommitted bump. `gen-ui-agent` is now green. `reasoning-custom` and `reasoning-default` fail: "no reasoning-role message rendered within 5000ms".                                                                                                                                                                                                                                                           |
| Phase 2 final run                   | **38/39 / 38/38** at `f73f47038a`, with the reasoning converter fix. 137 requests: 125 × 200 and 12 strict 503s, all from the thread-ID check.                                                                                                                                                                                                                                                                                         |
| AG-UI override vs TanStack 0.35     | **RED.** A global `@ag-ui/core` 1.0.1 override also replaces `@tanstack/ai` 0.35.0's own `^0.0.52`. Its ESM import then fails: "does not provide an export named 'RunAgentInputSchema'" (AG-UI 1.0 moved the schemas to `@ag-ui/core/schemas`), and 3 test suites cannot load. **GREEN** in phase 1 with `@tanstack/ai` exempted. Phase 2 drops the exemption: 0.64.1 imports only `AGUIError`/`EventType`, so one 1.0.1 copy remains. |
| `/api/smoke`                        | **RED twice.** 502 on every call: 1.77.0 rejects the `{ method }` envelope on the multi-route runtime. With only that fixed, it gave 200 "ok" while a queued 400 failed the run. **GREEN** (`3538cc3ac1`): 200 "ok", and 502 `run_error` with the 400 queued.                                                                                                                                                                          |
| (a) `shared-state-read`             | Gated on "Lemon Saffron Orzo" in the **system** message, where `convertInputToTanStackAI` puts the AG-UI state. **RED**: 12 × 503, and the model saw the default "Make Your Recipe". The Built-in Agent had the stale page. **GREEN** 4/4 once it was synced to the shared page (`9875b32373`). **RED** again with the state stripped, then **GREEN**.                                                                                 |
| (c) A2UI                            | **No stub:** `generate_a2ui` is the factory's own secondary-LLM tool (`injectA2UITool: false`). The shipped fixtures already run the 3-call flow. A prompt-gated scratch set: **GREEN** in phase 1 (twice) and phase 2. With an LGP-style raising stub: **RED** (surface-missing; no inner call).                                                                                                                                      |
| (d) REPAIR-041                      | **Confirmed and fixed** (`23670bd498`). Two turns through `HttpAgent`: before the fix, the log held only `[writing_agent]` after turn 2; after it, `[research_agent, writing_agent]`. Also passes in phase 2. Unit test RED→GREEN.                                                                                                                                                                                                     |
| (e) REPAIR-033                      | **Still present on voice 1.77.0**, which depends on `openai ^5.9.0` (TS2322 `#private`). **Fixed** with a local override that gives voice the integration's openai 6 (`8f6aa03851`). tsc goes from 59 to 58 diagnostics, and runtime behaviour does not change.                                                                                                                                                                        |
| (f) Thread-ID demo                  | **Still unshipped.** It is a feature but not a `demos:` entry, has no Built-in Agent fixture, and fails with 12 strict 503s in every run.                                                                                                                                                                                                                                                                                              |
| (g) Quickstart setup                | **PASS as written.** 14 of 14 fenced blocks are accounted for (11 visible, 3 hidden in pnpm/yarn/bun tabs). create-next-app 16.3.8 + `npm install` → `npm run dev` → page 200 → `info` → a run reaching `RUN_FINISHED` with the fixture's joke.                                                                                                                                                                                        |
| Static checks                       | `next build` passes in both phases. The four validators pass. Unit tests: 38/38 → 40/40 (+2 new). tsc: 59 diagnostics before → 58 after, none new (`ignoreBuildErrors` hides them from CI). `validate-pins` stays at 53 FAILs; the hash changes.                                                                                                                                                                                       |
| Docs checks (under the lock)        | pretypecheck and typecheck pass; guard 25/25; `current-v2-authored-guides` + `llm-text` 72/72.                                                                                                                                                                                                                                                                                                                                         |
| Peak audit RSS                      | **8.90 GB** (8,693,664 KiB), at boot 1 + the all-pages pre-warm. The matrix peak was 8.20 GB (phase 2 final). The 10.5 GB abort line never fired.                                                                                                                                                                                                                                                                                      |

## Provenance

- **Worktree.** `tyler/docs-feature-audit`. `git pull --ff-only` was a no-op at `88718205e2`, and the tree was clean.
- **CopilotKit is unpatched and registry-published** (`bia-copilotkit-provenance-20261006.log`).
  - All 31 `@copilotkit/*`, `@ag-ui/*` and `@tanstack/ai*` entries of the committed lock have the registry's own `dist.integrity`.
  - The lock has 0 `link:`, `file:` or git sources.
- **Toolchain.**
  - The locks were generated with Node v24.11.0 / npm 11.6.1, as LGTS, LGP, ADK and Strands did.
  - Everything else ran on Node v22.16.0 / npm 10.9.2: `npm ci`, the stack, the runner, tsc, vitest, `next build`, the validators, the setup reproduction and the docs checks.
  - `@copilotkit/aimock` is 1.37.4.
- **One stack at a time.** Port 3000 was never touched. The other checkouts' servers on 3061, 3063 and 3073 were not signalled.

## 1. Dependencies

### Phase 1 (`326090bcf8`, then `8f6aa03851`)

- **`package.json`.**
  - All five `@copilotkit/*` pins move from `^1.71.1` to exactly **1.77.0**.
  - `@ag-ui/client` **1.0.1** is added as a direct dependency. The factories import it, but before this it was reached only through hoisting.
  - `next` moves to `^15.5.27`. `openai` stays at `^6.49.0`, and `@tanstack/ai` 0.35.0 / `@tanstack/ai-openai` 0.15.6 are unchanged.
- **Overrides.** There was none before, so there was nothing stale to remove.
  - `@ag-ui/client` and `@ag-ui/core` are overridden to **1.0.1**, with `@tanstack/ai` exempted (`{"@ag-ui/core": "^0.0.52"}`).
  - Without overrides, `channels-core`, `-intelligence`, `-slack` and `-teams` nest 0.0.59 (`bia-ui-lock-update-20261006.log`), as in the other four integrations.
  - **Why the exemption** (`bia-override-global-red-20261006.log`, then `bia-override-scoped-green-20261006.log`). `@tanstack/ai` 0.35.0 depends on `@ag-ui/core ^0.0.52`, and its `chat-params.js` imports `RunAgentInputSchema` from the package root. AG-UI 1.0 moved the schemas to `@ag-ui/core/schemas`.
    - Under a global 1.0.1 override, `import("@tanstack/ai")` throws `SyntaxError: The requested module '@ag-ui/core' does not provide an export named 'RunAgentInputSchema'`, and 3 of the 9 vitest files fail to load.
    - `next dev` still served a run on that tree, because Turbopack binds the missing import as `undefined` and `chatParamsFromRequest` is unused.
    - With the exemption: ESM import ok, 8 files pass + 1 skipped. That is 38 tests, 40 after the REPAIR-041 tests.
- **REPAIR-033 override** (`8f6aa03851`, `bia-voice-openai-20261006.log`): `"@copilotkit/voice": {"openai": "$openai"}` removes the nested openai 5.23.2. That is the lock's only change.
- **Lock generation.** `npm install --package-lock-only --legacy-peer-deps --before=2026-10-05T12:00:00Z`. 903 entries; 251 entries were added or changed, with **0 age violations** (`bia-ui-lock-age-audit-p1-20261006.json`). The youngest is `@modelcontextprotocol/sdk` 1.32.1, at 36.6 h.
  - The two "exotic" `@emnapi/*` rows are `inBundle` entries of `@tailwindcss/oxide-wasm32-wasi`, with no `resolved` field.
- **One copy of each** (`bia-dependency-tree-p1-20261006.log`):
  - `@copilotkit/core`, `shared`, `runtime`, `react-core`, `voice`, `a2ui-renderer` and `web-inspector`, all 1.77.0;
  - `@ag-ui/core`, `client`, `encoder` and `proto`, all 1.0.1, plus `@tanstack/ai`'s private `@ag-ui/core` 0.0.52;
  - `@langchain/core` 1.2.14 (a runtime transitive), `next` 15.5.27, and `react` / `react-dom` 19.3.0.

### Phase 2 (`f73f47038a`)

- **`package.json`.** `@tanstack/ai` moves to **0.64.1** (published 10-05 13:04Z), and `@tanstack/ai-openai` to **0.26.0** (10-02 12:46Z; it peers on `^0.64.0`). That brings `@tanstack/openai-base` **0.12.3**, `ai-utils` 0.4.1 and `ai-event-client` 0.13.0. The `@tanstack/ai` exemption is dropped.
- **The `@ag-ui/core` duplicate.**
  - Without any override, `@tanstack/ai` 0.64.1 nests its exact `@ag-ui/core` **1.0.0** beside CopilotKit's 1.0.1, and channels-\* still nest 0.0.59 (`bia-ui-lock-update-p2-20261006.log`).
  - **Does it matter? No, in practice.** 0.64.1's dist imports only `AGUIError` and `EventType` from the `@ag-ui/core` root, and 1.0.1 exports both with the same values. The Built-in Agent's converters key on chunk `type` strings and build their own `@ag-ui/client` events, so no object crosses between the two copies.
  - The global override therefore collapses it to **one 1.0.1 copy**. The ESM import is ok, and the unit tests pass.
- **Lock generation.** `--before=2026-10-05T13:10:00Z`.
  - A first try at `21:00Z` also moved runtime transitives: `ai` 6.0.301, `@ai-sdk/*`, `graphql-yoga`.
  - The tighter bound changes **only the 5 TanStack packages**, with 0 age violations and 0 exotic entries (`bia-ui-lock-age-audit-p2-20261006.json`).
- **Breaking changes reviewed.**
  - Source: the GitHub release notes for `@tanstack/ai`, `-openai` and `openai-base` between 0.35 and 0.64. Also checked: the 0.64 `.d.ts` for `chat`, `toolDefinition`, `maxIterations`, `systemPrompts` and `RunErrorEvent`, and the runtime's `convertInputToTanStackAI` output.
  - **No API used by the factory broke.**
    - The default loop is still `maxIterations(5)`.
    - #696 removed the duplicate `TOOL_CALL_END`; the converter's dedupe is now a no-op.
    - Runtime 1.77.0 already drops `file`-source content parts before 0.64's new `chat()` check could throw.
  - **Two behaviours changed:**
    - #936: Responses function calls keep their `call_id`. This fixes `gen-ui-agent`.
    - The reasoning summary now streams as `REASONING_MESSAGE_CONTENT` instead of thinking `STEP` deltas. That broke the reasoning converter, which was fixed in the same commit.

## 2. Static checks

| Check                                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `next build` (the Dockerfile's step; CI's Docker build)                                                 | **Pass in both phases**: 46 static pages, max RSS 4.08 / 4.06 GB, 32.8 / 45.5 s. The only warnings are hashbrown's `Critical dependency` and the workspace-root inference (`bia-ui-next-build-p{1,2}-20261006.log`).                                                                                                                                                                       |
| `validate-parity`, `validate-shared-symlinks`, `sync-shared-frontends`, `validate-fixture-tool-surface` | **Pass** in both phases (`bia-ci-validators-p{1,2}-20261006.log`). Built-in Agent: 39 demos, 33 specs, 9 QA files, with 40 pre-existing warnings.                                                                                                                                                                                                                                          |
| `validate-pins` ratchet                                                                                 | **Red before and after; not fixed.** FAIL stays at **53** (the baseline is 26). The Built-in Agent's six lines change from `^1.71.1` to `1.77.0` (and `openai` is still not exact), so the hash goes from `f2b4f09e4b22ba4c` to `cf2d58293025f077`. The pre-update count was taken on the clean tree at `88718205e2` before any edit.                                                      |
| Unit tests (`vitest.config.ts`; not CI-gated for this integration)                                      | Phase 1 **38/38** (5 skipped, PocketBase) → **40/40** with the REPAIR-041 tests. Phase 2 **40/40** (`bia-unit-p2-20261006.log`).                                                                                                                                                                                                                                                           |
| `tsc --noEmit` (`ignoreBuildErrors: true` hides it from `next build`)                                   | 1.71.1 baseline **59** → phase 1 **59** (identical) → with the voice override **58** (only the voice TS2322 removed) → phase 2 **58** (identical; the `gpt-5.4` model-union messages now say "46 more"). The remaining 58 are pre-existing: `gpt-5.4` is not in the adapter's model union, cvdiag BigInt with target ES2017, A2UI Zod declarations, and others (`bia-tsc-*-20261006.log`). |

## 3. Boot and `/api/smoke`

- **AIMock.** The 10-06 command: `--strict --validate-on-load --chunk-size 8 --latency 60` with `AIMOCK_STRICT_TURN_INDEX=1`. It loaded **9056** fixtures (`bia-aimock-20261006.log`), and 9056 again after the fixture gate (`bia-aimock-ssr-20261006.log`).
- **Stack.** The documented `npm run dev` (`next dev --turbopack`) on port 3117, with `OPENAI_BASE_URL` set to AIMock (`bia-stack-20261006.sh`; batches by `bia-batch-20261006.sh`; sampler `bia-rss-sampler-20261006.sh`).
  - `/api/health` returned 200 after 2–3 s.
  - All 41 demo pages returned 200 (`bia-prewarm-20261006.log`). On GET, the 14 API route roots return 404 (multi-route, no root handler) and auth returns 401.
  - `info` reports runtime **1.77.0** with 28 agents on `/api/copilotkit`.
- **`/api/smoke`** (`bia-smoke-route-20261006.log`, `-endpoint-only-red-`, `-after-`, `-p2-`):
  - **RED 1.** The route posted `{ method: "agent/run" }` to `/api/copilotkit`, which is a `[[...slug]]` multi-route runtime. 1.77.0 answers that with 400 `single_route_envelope_against_multi_route_runtime`, so the route returned **502 on every call**, and AIMock got 0 requests.
  - **RED 2** (only the endpoint changed; `bia-smoke-route-endpoint-only-20261006.diff`). It answered **200 "ok"** while the queued 400 failed the provider call. That is the Strands/ADK first-chunk false positive.
  - **Fix (`3538cc3ac1`).** POST the `RunAgentInput` to `/api/copilotkit/agent/default/run`, and use the Strands `96eb243ad2` pattern: `randomUUID()` ids, and read the stream to its terminal event.
  - **GREEN.** 200 "ok" (1.05 s, one fixture match); 502 `run_error` "400 injected provider failure"; 200 again. Phase 2 gives the same.
  - No other integration posts the envelope to a catch-all route.

## 4. Full strict D6 matrix

- **The runner.** `run-local-d6.mts built-in-agent --demos <batch>`, with the Strands command and environment.
- **Batches.** The Strands five-batch split, adjusted to the Built-in Agent's 37 features:
  - A1: `beautiful-chat`, `cli-start`, `agentic-chat`, `prebuilt-sidebar`, `prebuilt-popup`, `chat-slots`, `chat-customization-css` and `headless-simple`.
  - A2: `headless-complete`, `reasoning-custom`, `reasoning-default`, `frontend-tools`, `-async`, `gen-ui-tool-based`, `hitl-in-app`, `hitl-in-chat`, `declarative-gen-ui`, `a2ui-fixed-schema` and `a2ui-recovery`.
  - B1: `mcp-apps`, `gen-ui-agent` and the three `tool-rendering*` cells.
  - B2: `shared-state-read`, `-read-write`, `readonly-state-agent-context`, `subagents` and `multimodal`.
  - B3: `auth`, `declarative-hashbrown`, `declarative-json-render`, `open-gen-ui`, `-advanced`, `voice`, `agent-config` and `threadid-frontend-tool-roundtrip`.
- **Each batch** ran on a fresh boot: `.next` removed, the batch's pages and every API route pre-warmed, and the journal reset.
- **Raw vs published.** 39 raw checks. `cli-start` has no D6 check; `beautiful-chat` expands into 5; `declarative-hashbrown` and `-json-render` fold into `byoc`. Published = 38, which excludes the unshipped thread-ID check, as on 09-13.

| Run (`bia-runtime-matrix-20261006.json`) | HEAD                | A1    | A2    | B1  | B2  | B3  | Raw       | Published | Requests (all with the 3 headers) |
| ---------------------------------------- | ------------------- | ----- | ----- | --- | --- | --- | --------- | --------- | --------------------------------- |
| Phase 1 first                            | `3538cc3ac1`        | 11/11 | 11/11 | 4/5 | 5/5 | 6/7 | **37/39** | **37/38** | 163 (151 × 200, 12 × 503)         |
| Phase 1 final                            | `8f6aa03851`        | 11/11 | 11/11 | 4/5 | 5/5 | 6/7 | 37/39     | 37/38     | 163 (151 / 12)                    |
| Phase 2 first                            | `8f6aa03851` + bump | 11/11 | 9/11  | 5/5 | 5/5 | 6/7 | 36/39     | 36/38     | 139 (127 / 12)                    |
| Phase 2 final                            | `f73f47038a`        | 11/11 | 11/11 | 5/5 | 5/5 | 6/7 | **38/39** | **38/38** | 137 (125 / 12)                    |

- **Logs.** Each run has `bia-d6-<tag>-<batch>-20261006.log`, with matching `bia-dev-stack-…`, `bia-prewarm-…` and `bia-d6-journal-…` files. The tags are `full`, `final`, `p2` and `p2final`.
- **Truncated journals.** In the four A2 journals, the 21 A2UI system prompts longer than 8,000 characters each (about 56 KB of catalog) are cut to their first 2,000 characters, plus their length and a sha256 prefix. That keeps each file under the repo's 1 MB `check-binaries` limit. The untruncated copies stay in the session scratchpad.
- **Retries.** The driver's own feature retries are counted in the JSON. Every failure shown failed both of its attempts.

### Failures, root causes and fixes

1. **`gen-ui-agent` (phase 1). Upstream defect; fixed by phase 2.**
   - **The assertion.** `waitForTurnComplete: turn 1 did not complete within 60000ms (reason=surface-missing, runsFinished=1 …)`, with the page showing "Stopped at step 1 of 3". It failed both attempts in the first run, in the separate rerun (`bia-d6-full-RR-20261006.log`) and in the final run.
   - **What the journal shows.** All 50 requests matched the opening `{"userMessage":"Plan a product launch"}` fixture, and none matched the `toolCallId: "call_d5_set_steps_launch_00N"` follow-ups. Each follow-up's tool result carried `tool_call_id` `fc-…`: AIMock's Responses **item** id, not the fixture's `call_id`. So the model repeated step 1 until `maxIterations(25)`.
   - **The cause.** `@tanstack/openai-base` 0.9.2 (`responses-text.js`) sets `toolCallId: item.id` and echoes it as `call_id`. That violates the Responses contract, and TanStack fixed it in #936 (`item.call_id || item.id`; present from 0.9.12, absent in 0.9.8). 0.9.2 is the last release that peers on `@tanstack/ai` 0.35, so the fix needs the phase-2 bump.
   - **Minimal repro.** `bia-tanstack-callid-repro.mjs`: one `chat()`, one server tool, a scratch strict AIMock. On 0.35/0.9.2 it gets toolCallIds `fc-…`, three requests and no follow-up match: **FAIL** (`bia-tanstack-callid-repro-p1-20261006.log`). On 0.64.1/0.12.3 it gets `call_repro_1`, and the follow-up matches: **PASS** (`-p2-`).
   - **Why 09-13 passed.** The shared `InlineAgentStateCard` canonicalised on 09-23 (`c16d837d75`) derives its headline from the step data. A loop stuck on step 1 now reads "Stopped" and fails surface-ready. This explanation was not bisected.
2. **`threadid-frontend-tool-roundtrip`.** It is unshipped: no Built-in Agent fixture exists. The assertion is `turn 1 did not complete … (reason=dom-missing …)`, with 12 strict 503s for "invoke testFrontendToolCalling with label X". See (f).
3. **`reasoning-custom` / `reasoning-default` (phase 2 first run).**
   - **The assertion.** `reasoning-display: no reasoning-role message rendered within 5000ms`.
   - **The cause.** `openai-base` 0.12 still opens the trace with a thinking `STEP_STARTED`, but it streams the summary as `REASONING_MESSAGE_CONTENT` deltas; its `STEP_*` chunks no longer carry `delta`. The custom converter therefore opened an empty reasoning message.
   - **The fix** (in `f73f47038a`). Forward `REASONING_MESSAGE_CONTENT` deltas.
   - **GREEN.** Both cells plus `agentic-chat`, `frontend-tools` and `tool-rendering`: 5/5 (`bia-d6-p2rg-reasoning-green-20261006.log`), and both pass in the phase 2 final run.

### AG-UI 1.0

No event- or message-shape breakage reached the wire. Every run, frontend-tool round trip, state delta, A2UI and MCP Apps activity, reasoning stream and HITL cell passed on `@ag-ui/client` 1.0.1. The only AG-UI 1.0 breakage is the package-level `RunAgentInputSchema` move above.

## 5. The rechecks asked for

### (a) `shared-state-read`: gated, with the page fixed (`9875b32373`)

- **Where the recipe goes.** The runtime's `convertInputToTanStackAI` appends the AG-UI state to `systemPrompts` as "Application State: `json …`". The journal shows it in a **system** message on both turns, so the fixture now matches `systemMessage: "Lemon Saffron Orzo"`, as ADK and LGP do. The replies name the recipe.
- **RED** (`bia-d6-redgreen-ssr-red-20261006.log`).
  - `shared-state-read`: **fail** on both attempts (`turn 1 did not complete within 55000ms (reason=dom-missing …)`). The 3 neighbours pass.
  - 12 × 503. Every system prompt carried `"title": "Make Your Recipe"`, the default, although the probe had typed the edit and asserted it stuck.
- **The real defect.** The Built-in Agent was missing from `sync-shared-frontends.ts`'s shared-state-read fan-out, so it kept the pre-`21bc38e0dd` page.
  - That page re-seeds the recipe on every agent reference change. The edit made against the provisional agent was lost when the runtime-synced agent replaced it.
  - The other four selected integrations already had the canonical page, which waits for `isReady`.
  - **Fix.** Add the Built-in Agent to the fan-out and sync (`--write`). The sync test passes. No other target changes.
- **GREEN** (`-ssr-green-`). 4/4 with `shared-state-write`, `readonly-state-context` and `agentic-chat`; 9 requests, all 200. Both gated fixtures matched.
- **RED again** (`-ssr-red2-`, stub `bia-shared-state-read-red-stub-20261006.diff`, never committed). The state was dropped before conversion: **fail**, 12 × 503.
- **GREEN again** (`-ssr-green2-`) after `git checkout`. Both final runs matched the gated fixtures as well.

### (b) `/api/smoke`

See §3.

### (c) A2UI: `generate_a2ui`

- **How the Built-in Agent wires it.** The Built-in Agent has no LGP-style stub.
  - `declarative-gen-ui` and `a2ui-recovery` own a real `generate_a2ui`: a secondary-LLM design call with validate/retry for recovery.
  - Their routes set `injectA2UITool: false`; `beautiful-chat` injects `render_a2ui`.
  - The shipped fixtures already run outer `generate_a2ui` → inner design call → follow-up (matrix A2 journal).
- **The scratch set.** `bia-a2ui-live-order-fixtures-20261006.json` has the shipped responses for the 4 sales pills, reordered.
  - The follow-ups are gated on `hasToolResult`.
  - The outer call is gated on the agent's own system prompt ("demo assistant for Declarative Generative UI") and answers `generate_a2ui`. The inner call comes last.
  - It does not gate on `toolCallId`, because of the phase-1 adapter defect.
  - The runner is `bia-a2ui-run-20261006.sh`, on a strict AIMock on :4411.

| Run (`--demo declarative-gen-ui`)                                                                                         | Result                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GREEN at `9875b32373` (phase 1)                                                                                           | **Pass, 66.1 s** (the shipped set also takes 66 s: the large inner answers stream in 8-character chunks). 12 requests, all 200, all with the three headers. Per pill: the gated outer call, the inner call (no tools), the follow-up. |
| Negative control: `generate_a2ui` throws "generate_a2ui called directly" (`bia-a2ui-stub-negative-control-20261006.diff`) | **Fail**: `turn 1 did not complete within 90000ms (reason=surface-missing …)` on both attempts. 4 requests: no inner call, and the tool result is `{"error":"generate_a2ui called directly"}`.                                        |
| GREEN again (`green2`) / phase 2 (`p2green`)                                                                              | **Pass, 66.1 s / 66.1 s**, with the same 12-request flow.                                                                                                                                                                             |

### (d) REPAIR-041: the delegation log across runs (`23670bd498`)

- **The check.** `bia-subagents-two-turn.mjs` drives the `subagents` agent through `@ag-ui/client`'s `HttpAgent`, the client class CopilotKit uses. It keeps `agent.state`, sends it as `RunAgentInput.state` and applies deltas.
  - Two turns use scratch fixtures (`bia-subagents-two-turn-fixtures-20261006.json`): turn 1 → `research_agent`, turn 2 → `writing_agent`.
- **RED** (`bia-subagents-two-turn-red-20261006.log`). Turn 2 sent `delegations = [research_agent]`, but its `STATE_DELTA` was `add /delegations [writing_agent]`. Afterwards the log held **`writing_agent` only**: confirmed.
- **The cause.** `convertStream` started each run from `[]` and emits the whole array, so the first delegation of every later run replaced the earlier entries.
- **Fix.** Seed the list from `input.state.delegations`. Unit tests: `bia-subagents-unit-red-20261006.log` (1 failed: `expected [ 'call-run2' ] to deeply equal [ 'call-run1', 'call-run2' ]`) → `-green-` (40/40).
- **GREEN.** `[research_agent, writing_agent]` (`-green-`, and `-p2-` on 0.64.1). The `subagents` D6 cell plus 3 neighbours: 4/4.

### (e) REPAIR-033: voice and openai (`8f6aa03851`)

- **Still present.** `@copilotkit/voice` 1.77.0 still has `dependencies.openai: ^5.9.0`. Its `TranscriptionServiceOpenAIConfig.openai` is typed against its own openai 5, while the shared `transcription-service.ts` passes an openai 6 client. tsc reports `TS2322 … Property '#private' in type 'OpenAI' refers to a different member`.
- **What voice does with openai.** It only calls `this.openai.audio.transcriptions.create(…)` on the client it is given. Its own copy is reached only by the `config.openai ?? new OpenAI()` fallback, which the shared service never takes.
- **Fix.** A Built-in Agent–local override, `"@copilotkit/voice": {"openai": "$openai"}`. Shared sources are untouched; the other four integrations use openai 5 and never had the mismatch.
- **Result.**
  - Only openai 6.49.0 is on disk. tsc goes from 59 to 58 diagnostics: only that diagnostic is removed, and none is added.
  - `transcription-service.test.ts` passes, and `voice`, `multimodal` and `agentic-chat` are 3/3 in D6.
  - Runtime behaviour does not change: the same openai 6 client makes the same call.

### (f) The thread-ID demo

Status: **still unshipped, unchanged since 09-13.**

- `threadid-frontend-tool-roundtrip` is in `features:`; the agent is registered and the page exists.
- It is deliberately not a `demos:` entry: the manifest NOTE says the `constrained-explicit` allowlist does not list it.
- The feature registry marks it `kind: testing`.
- There is no `showcase/aimock/d6/built-in-agent/threadid-frontend-tool-roundtrip.json`, while LGP, LGTS, ADK, LlamaIndex and google-antigravity have one.
- It fails strictly in all four full runs, and it is excluded from the published count.

### (g) Quickstart setup reproduction

The scripts are `reproduce-bia-byoc-setup.sh` and `extract-bia-quickstart.py` (`ba1bb258c7`). The log is `bia-byoc-setup-20261006.log`, exit 0.

- **The guide.** The Built-in Agent is `ROOT_FRAMEWORK`, so the root `/quickstart` serves `docs/integrations/built-in-agent/quickstart.mdx`. The `docs/quickstart.mdx` file is only a routing shim with no code.
- **Tabs and block count.** The only Tabs are the `package-manager` group on "Start the development server". The `<FrontendOnly>` blocks hold callouts only, and ` ```npm ` is fumadocs' package-manager fence (npm form). Result: **11 visible + 3 hidden (pnpm/yarn/bun) = 14 of 14** fenced blocks.
- **As written: PASS.**
  - `npx create-next-app@latest my-copilot-app` (bounded to create-next-app **16.3.8**; non-interactive defaults) → `npm install @copilotkit/react-core @copilotkit/runtime` (1.77.0).
  - Then the guide's `.env`, `route.ts`, `providers.tsx`, `layout.tsx` and `page.tsx`, verbatim, and `npm run dev` (with `PORT=3118`).
  - `GET /` returned 200 with "Your App"; `info` returned 1.77.0 with `["default"]`.
  - `POST /api/copilotkit/agent/default/run` with "Can you tell me a joke?" gave `RUN_STARTED … TEXT_MESSAGE_* … RUN_FINISHED` with the fixture's joke. One `gpt-5.4-mini` `/v1/responses` request matched (200).
- **Note.** The guide does not pin `@ag-ui/*`, so its install keeps the channels-\* 0.0.59 copies next to 1.0.1. A text run works across them.
- **No guide change was needed.**
- **Not reproduced:** the browser chat UI itself (only page render + the provider's REST transport), the Intelligence CTA, the Inspector step, and the pnpm/yarn/bun tabs.

## 6. Docs checks

These ran under `lockf -t 3600 /private/tmp/claude-501/shell-docs-gen.lock` at `ba1bb258c7`, with the stack stopped:

- `npm run pretypecheck && npm run typecheck`: **pass** (`bia-qual-shell-docs-typecheck-20261006.log`).
- Guard `selected-showcase-guide-bindings.test.ts` (`--maxWorkers=1 --execArgv=--max-old-space-size=4096`): **25/25** (`bia-qual-guard-bindings-20261006.log`).
- `current-v2-authored-guides` + `llm-text`, with the same flags: **2 files, 72/72** (`bia-qual-docs-tests-20261006.log`).
- Generation changed no tracked file. The Built-in Agent's `shared-state-read-publish` region now comes from the canonical page, which waits for `isReady`.

## Commits

| SHA          | Subject                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| `326090bcf8` | chore(showcase): update Built-in Agent to CopilotKit 1.77.0 and AG-UI 1.0                   |
| `3538cc3ac1` | fix(showcase): make the Built-in Agent smoke route reach its runtime and fail on run errors |
| `9875b32373` | fix(showcase): send the edited recipe to the Built-in Agent and gate its fixture on it      |
| `23670bd498` | fix(showcase): keep the Built-in Agent's earlier delegations on later runs                  |
| `8f6aa03851` | fix(showcase): resolve @copilotkit/voice's openai to the Built-in Agent's openai 6          |
| `f73f47038a` | chore(showcase): update the Built-in Agent to @tanstack/ai 0.64.1 (phase 2)                 |
| `ba1bb258c7` | test(audit): reproduce the Built-in Agent quickstart setup                                  |

This record, its scripts and logs are committed after them.

**Shared sources changed:** only `showcase/scripts/sync-shared-frontends.ts`. It adds the Built-in Agent to the shared-state-read fan-out, so it affects **only the Built-in Agent**: the four existing targets are unchanged, and `sync-shared-frontends` reports no drift.

## Upstream findings (not filed; drafts for a human)

1. **`@tanstack/openai-base` ≤ 0.9.8 answers Responses function calls under the item id** (`fc_…`), not `call_id`. It echoes that as `function_call_output.call_id`. This is fixed upstream by TanStack/ai#936 (0.9.12+), which needs `@tanstack/ai` ≥ 0.44, so **any `@tanstack/ai` 0.35 user is affected**. Repro: `bia-tanstack-callid-repro.mjs`.
2. **`@tanstack/ai` ≤ 0.35 cannot run against `@ag-ui/core` 1.x.** Its root import of `RunAgentInputSchema` fails under ESM. This is not a TanStack bug (its range is `^0.0.52`), but an app that globally overrides AG-UI to 1.0 for CopilotKit 1.77.0 breaks it.
3. **`@copilotkit/voice` 1.77.0 still pins `openai ^5.9.0` as a regular dependency.** Apps on openai 6 get two copies and a type error. A peer dependency (or `>=5`) would fix it.
4. **`@copilotkit/runtime` 1.77.0 pulls two AG-UI versions** (channels-\* 0.11.x pin 0.0.59). This is unchanged from the other four records, and the Built-in Agent quickstart's plain install inherits it.

## Remaining defects and notes

1. **`validate-pins` is red**: 53 FAILs against a baseline of 26. The canonical pin is still 1.68.2.
2. **The thread-ID check is unshipped**: there is no fixture and no `demos:` entry (§5f).
3. **58 pre-existing tsc diagnostics**, hidden by `ignoreBuildErrors`. One cause is that `gpt-5.4` is not in `@tanstack/ai-openai`'s model union even in 0.26.0.
4. **Not exercised:** `declarative-json-render` (folded into `byoc`), and the not-supported `hitl`, `shared-state-streaming`, `gen-ui-interrupt`, `interrupt-headless`, `reasoning-default-render`, `agentic-chat-reasoning` and `tool-rendering-reasoning-chain`. The last uses the fixed reasoning converter but was not run.
5. **The vitest suite is not CI-gated for this integration.** `test_unit-showcase-integrations.yml` covers only `strands-typescript`.

## Resources

- **Load.** Every heavy step ran under `nice -n 10`, one stack at a time. The batch driver waits until the 1-minute load is ≤ 15 before each boot and each runner.
  - The highest sampled load was **16.59**, at 01:16:48–01:17:05Z, during the phase-2 all-41-pages pre-warm. That boot started at a load of 7.22. No step started while the load was above 16.
  - `next build`, the setup reproduction and the docs checks each started at a load of 6–7.
- **RSS** was sampled every 2 s over the descendants of AIMock, each boot, each runner (with Chromium) and the scratch AIMocks (`bia-rss-20261006.log`, abort line 10.5 GB). It never fired.

  | Phase                                  | Peak (sum of RSS) | Largest process       |
  | -------------------------------------- | ----------------- | --------------------- |
  | Boot 1 + all-41-pages pre-warm + smoke | **8.90 GB**       | `next-server` 8.24 GB |
  | Phase 1 first / final                  | 7.92 / 7.97 GB    | `next-server` 5.66 GB |
  | Red/green, probes, A2UI checks         | 6.61 GB           | `next-server` 4.25 GB |
  | Phase 2 boot + pre-warm + smoke        | 8.36 GB           | `next-server` 7.88 GB |
  | Phase 2 first / final                  | 7.92 / 8.20 GB    | `next-server` 5.78 GB |

  The sum counts shared Chromium pages more than once. `next build` (max RSS 4.08 GB), tsc, the setup reproduction and the docs checks ran with no stack up.

## Limitations

- **AIMock replay is not a live provider.** Strict replay proves protocol, rendering and state behaviour against recorded fixtures, not real OpenAI behaviour.
  - The `call_id` defect matters for fixture gating and AG-UI tool-call ids. Whether real OpenAI accepts the item id as `call_id` was not tested.
  - The A2UI order proof stands in for a live model with a prompt-gated scratch set.
  - `voice` covers the bundled transcript handoff: `OPENAI_TRANSCRIPTION_API_KEY` was unset, so `/transcribe` and real transcription were not exercised. `multimodal` covers the sample buttons.
- **Host-native, not Docker.** Host Node 22.16.0. The image's `npm ci` + `next start` were checked only by host `npm ci --legacy-peer-deps` and `next build`.
- **MCP Apps needs a live external server.** `mcp-apps` discovers `create_view` from `https://mcp.excalidraw.com/mcp` even under strict replay.
- **The matrix is five runner processes on five boots per run**, forced by the RSS cap.
- **The setup reproduction proves the page render and one text run** through the guide's route. It does not prove an in-browser chat.

## Cleanup

- **Stopped.** Every stack boot (the `npm run dev` process group), AIMock :4410 (both instances) and every scratch AIMock on :4411 were stopped with SIGTERM to their process groups. The RSS sampler was stopped, and every runner exited on its own.
- **The setup script cleaned up after itself.** It stopped its dev server and its AIMock on :4412 (`port 3118 after stop: free`) and removed `/private/tmp/bia-byoc-setup.*`.
- **Ports.** 3117, 3118, 4410, 4411 and 4412 are free, and port 3000 was never touched.
- **Left in place.** The ignored `.next/` and the phase-2 `node_modules/` in `showcase/integrations/built-in-agent`. The scratch copies (the phase-2 probe tree, the fixture copies and the package tarballs) are in the session scratchpad.
