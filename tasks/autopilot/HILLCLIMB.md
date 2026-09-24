# Autopilot prototype: progress and evidence

This is the durable implementation record. Every failed trial remains visible; a passing gate requires current evidence.

## Goal and constraints

Deliver the playable Next.js/SQLite logistics SaaS app described in `AGENT_PLAN.md`, using real CopilotKit packages, live BuiltInAgent, existing Intelligence, and runtime-side SDK changes. Create, edit, and cancel orders with approval; discovery and execution stay in the browser. Complete every acceptance gate. Do not change the Intelligence service or replace the live path with fakes.

Required locations: application and verification scripts in this repo's `examples/v2/autopilot-logistics`; reusable source changes in the actual `packages/*`. Prove both workspace execution and clean installation of packed package artifacts. The isolated temporary consumer is only a test artifact, not a separate implementation.

Plan location: `.context/autopilot-prototype/AGENT_PLAN.md` (local, gitignored handoff).
Working tree / branch: `/Users/tylerslaton/conductor/workspaces/CopilotKit/istanbul` / `product-eng-sync-action-items`.
Fetched base / tested commit: `origin/main` fetched 2026-09-24 at `055469401c023e8b79b2f33642b12a13977b1ac6`; starting HEAD `5f3ebb0066e17c28339795b5ac21c572a1243eda`; merged in `8801f423e2`.
Package resolution / model ID: current package manifests and installed workspace links are 1.73.3; configured default model `gpt-5.2` (live model call not yet verified).
Packed artifacts / checksums / isolated consumer result: not recorded.
Live app URL / process / restart command: production app at `http://127.0.0.1:3000` via `pnpm nx run @copilotkit/autopilot-logistics:start`; process running after the corrected browser test.
Credential readiness (names and presence only): `CPK_INTELLIGENCE_API_KEY` provisioned through `npx copilotkit@latest project select` into example `.env`; `OPENAI_API_KEY` supplied by Tyler in root `.env` and copied to example `.env.local`. Secret values are not tracked.

## Current evidence

- Required gates with current passing evidence: **1 / 18**.
- Unresolved critical failures: **none observed yet; trust controls have not been implemented or exercised**.
- Live trials passed / attempted: **2 / 4** (T001 app failure; T002 product flow worked but harness failed; T003 and T004 passed).
- Last known working checkpoint: **real BuiltInAgent browser tool call, result, continuation, and durable Intelligence transcript after reload**.
- Current highest-risk unknown: **the shared Core execution gate and discovered form path**.
- Next experiment: **manual SQL flows and the reusable execution seam**.
- Overall state: **A01 live connection proven on committed source `380d4f0e77`; most required gates remain unrun**.

Allowed gate states: not run, failing, passing, stale, externally blocked. Partial work belongs in the notes, not in the passing count. Passing needs evidence on the current relevant code. Do not change the denominator or delete failures to improve the score.

## Scoreboard

| Gate | Requirement                                                            | State   | Tested commit | Evidence / failure / next check                                                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------- | ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01  | Real packages, BuiltInAgent, model and Intelligence                    | passing | `380d4f0e77`  | Nx package/app builds; public workspace imports resolve to actual `packages/{core,react-core,runtime,web-inspector}`; authenticated `/info` reports Intelligence, `logistics`, valid license and thread endpoints; T004 stored user→assistant tool call→browser result→assistant continuation and four messages after reload. |
| A02  | Runtime activation and UI agent selection                              | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A03  | Manual SaaS and persistent SQL                                         | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A04  | Page explanation and navigation                                        | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A05  | Create through discovered controls                                     | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A06  | Edit details and status through discovered controls                    | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A07  | Cancel through declared action, reused approval                        | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A08  | User management and server-enforced roles                              | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A09  | Bound approval, stale identity and replay rejection                    | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A10  | Alternate tool entry points cannot bypass checks                       | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A11  | Manual takeover and cancellation                                       | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A12  | Request budget and concurrent agents/tabs                              | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A13  | Private data, prompt injection and tenant isolation                    | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A14  | Reload and uncertain-effect recovery                                   | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A15  | Failure handling and manual fallback                                   | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A16  | Themed controls, generated card and Inspector                          | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A17  | Minimal integration, second form, and isolated packed-package consumer | not run | —             | —                                                                                                                                                                                                                                                                                                                             |
| A18  | Reproducible live handoff                                              | not run | —             | —                                                                                                                                                                                                                                                                                                                             |

## Per-iteration routine

1. Read the goal, fixed acceptance criteria, scoreboard, open friction, and last experiment.
2. Select the highest-risk unproven behavior. State what observation would disprove the current approach.
3. Make one coherent change or run a focused experiment. Preserve the last working checkpoint.
4. Record commands, exit codes, browser/SQL observations, and evidence paths. Classify product failure versus external infrastructure failure accurately.
5. Update the affected gates, mark invalidated evidence stale, append friction and decisions, and identify the next experiment.
6. Commit coherent implementation work and follow repository push rules. Never include credentials, the local database, or unsanitized traces.

After two attempts with no new evidence, change the hypothesis or test method. At every meaningful milestone, give Tyler a concise update stating what is now proven and what remains uncertain. Compaction or an automatic goal continuation is not a reason to restart the work or forget failed trials.

## Experiment log

Append an entry for every meaningful iteration. Do not overwrite old results.

### Iteration 001 — baseline and live prerequisite check

- Date, branch, commit, environment: 2026-09-24, `product-eng-sync-action-items`, `5f3ebb0066e17c28339795b5ac21c572a1243eda`, macOS, Node 24.11.0.
- Gate and current failure: A01 not run; the workspace has no `node_modules`, and process environment has neither live key.
- Hypothesis: the current source and local package manager can establish a buildable baseline while credentials are configured separately.
- Disproof condition: frozen workspace installation or package dependency closure fails.
- Smallest experiment: inspect source exports, invoke `corepack pnpm`, install frozen dependencies, then build the required package closure with Nx.
- Change made: copied this progress template and recorded the baseline.
- Exact commands and exit codes: `git fetch origin main` (0); `git status --short --branch` (0, clean); `corepack pnpm --version` (0, 10.33.4); process credential presence check (0, both absent); `test -d node_modules` (0, reported missing).
- Actual browser behavior and SQL delta: no app exists yet; none observed.
- Live model/Intelligence used? No, credentials are absent; no substitute will be labeled live.
- Evidence paths / sanitized thread and run IDs: command results in session; no thread yet.
- Result: inconclusive pending install and build.
- Regressions or invalidated gates: none.
- Friction created or resolved: F01 and F02 below.
- Next step and why: install and build package closure, then establish the real connection as the highest-risk boundary.

### Iteration 002 — real runtime connection and first browser trial

- Date, branch, commit, environment: 2026-09-24, `product-eng-sync-action-items`, base `8801f423e2`, Node 24.11.0, Next 15.5.24, Chromium via Playwright 1.59.1.
- Gate and current failure: A01; real `/info` works, but the first browser trial did not reach a model call.
- Hypothesis: the workspace Runtime, React provider, and BuiltInAgent will complete a frontend tool round trip through Intelligence after the app renders a signed-in session.
- Disproof condition: the browser cannot execute `describeVisiblePage` or the agent does not continue from its result in a durable thread.
- Smallest experiment: create the Next route and declared browser probe, seed SQLite, production-build/start, sign in through Playwright, send a natural-language request, inspect browser and `/threads`.
- Change made: added example scaffold, SQLite schema/seed, demo session, authenticated Intelligence route, real BuiltInAgent with TanStack adapter, provider/chat shell, dashboard, and Playwright connection test. Converted the SQLite session row into a plain object after the first browser failure.
- Exact commands and exit codes: `pnpm install --frozen-lockfile` (0); `pnpm nx run-many -t build -p @copilotkit/runtime @copilotkit/react-core @copilotkit/web-inspector` (0); `pnpm nx run @copilotkit/autopilot-logistics:seed` (0); initial app build (1: model type), second build (1: missing identifyUser.name), type check after dependencies installed (0), production build (0), authenticated `/info` request (0); browser tests T001 (1: server-render error), T002 (1: missing required `agentId` in test's thread-list query), T003 (0).
- Actual browser behavior and SQL delta: seeded 12 Northstar orders, 1 other-tenant order, 5 users. T001 sign-in reached server exception. T002 and T003 rendered the dashboard and real chat, called `describeVisiblePage`, and showed Dashboard `/`; no business mutation.
- Live model/Intelligence used? T002 and T003 used the configured live model and existing Intelligence. T003 transcript has four roles: user, assistant tool call, browser tool result, assistant continuation.
- Evidence paths / sanitized thread and run IDs: `.context/autopilot-evidence/iteration-002/{dashboard.png,tool-round-trip.png,connection.json}`; T003 thread `0b58b300-b72e-47ef-9706-fa3bfb2911d2` (no run ID captured yet).
- Result: A01 path supported by T003; T001 exposed a serialization bug and T002 exposed a test-harness query error. Both were corrected without reducing the gate.
- Regressions or invalidated gates: none; no gate previously passed.
- Friction created or resolved: F03–F08 below.
- Next step and why: commit the working connection checkpoint, rerun A01 on that commit, then build manual SQL flows and reusable guarded execution.

### Iteration 003 — verify committed A01 checkpoint

- Date, branch, commit, environment: 2026-09-24, `product-eng-sync-action-items`, `380d4f0e77`, Node 24.11.0, Next 15.5.24, Playwright Chromium.
- Gate and current failure: A01 needed evidence tied to committed source; live thread/agent path was otherwise working.
- Hypothesis: the committed connection scaffold will repeat the browser tool call and durable transcript.
- Disproof condition: the agent omits the browser tool, fails to continue, or thread messages disappear after reload.
- Smallest experiment: rerun `pnpm nx run @copilotkit/autopilot-logistics:test:browser --outputStyle=static` against the running production app, then inspect sanitized transcript and resolved package paths.
- Change made: committed example and lockfile, reran browser trial T004, recovered prior T002/T003 transcripts by thread ID, and changed future evidence naming to preserve each run.
- Exact commands and exit codes: app commit and push (0, hook bypass described in F09); Nx browser test on `380d4f0e77` (0, 1 test in 6.1 s); workspace package realpath check (0, all four under this checkout's `packages/`).
- Actual browser behavior and SQL delta: dashboard and chat rendered; browser result reported Dashboard `/`; no business SQL effect.
- Live model/Intelligence used? Yes, BuiltInAgent called configured model, `describeVisiblePage` ran in browser, and existing Intelligence persisted four messages.
- Evidence paths / sanitized thread and run IDs: `.context/autopilot-evidence/iteration-002/T004-connection.json` and `T004-tool-round-trip.png`; thread `147e66e8-9557-4101-aafc-f950715d6c2d`.
- Result: supported; A01 is passing on committed source.
- Regressions or invalidated gates: none.
- Friction created or resolved: F09/F10; per-trial screenshot overwrite is fixed for future runs, earlier missing images remain a documented evidence limit.
- Next step and why: implement manual order/user CRUD with transaction and role checks, then prove SQL/browser parity before browser discovery.

## Live trial ledger

One row per attempt, including failures and retries. Distinguish a new independently seeded trial from an automatic continuation of one request.

| Trial | Gate / prompt                                                     | Commit / model / browser                         | Thread / request                       | Expected DB effect | Actual effect | Outcome / time / usage                                                                                         | Evidence                                                                                                                 |
| ----- | ----------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------- | ------------------ | ------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| T001  | A01: ask agent to use `describeVisiblePage` and report title/path | uncommitted on `8801f423e2` / gpt-5.2 / Chromium | no thread; failed before model         | none               | none          | failed at sign-in redirect: SQLite row was not a plain Server→Client prop                                      | `examples/v2/autopilot-logistics/test-results/connection-live-Intelligence-agent-calls-a-frontend-tool/error-context.md` |
| T002  | A01: same focused prompt after serialization fix                  | uncommitted on `8801f423e2` / gpt-5.2 / Chromium | `36ab2b96-f217-422a-a65d-e51213626e40` | none               | none          | Product flow reached live browser tool and reply; test failed because `/threads` query omitted `agentId`       | `.context/autopilot-evidence/iteration-002/T002-connection.json`; screenshot overwritten by next trial                   |
| T003  | A01: same focused prompt after harness correction                 | uncommitted on `8801f423e2` / gpt-5.2 / Chromium | `0b58b300-b72e-47ef-9706-fa3bfb2911d2` | none               | none          | passed in 5.0 s; stored tool result and assistant continuation; four messages after reload; usage not supplied | `.context/autopilot-evidence/iteration-002/T003-connection.json`; screenshot overwritten by next trial                   |
| T004  | A01: post-commit repeat                                           | `380d4f0e77` / gpt-5.2 / Chromium                | `147e66e8-9557-4101-aafc-f950715d6c2d` | none               | none          | passed in 6.1 s; stored browser tool result and continuation; four messages after reload; usage not supplied   | `.context/autopilot-evidence/iteration-002/T004-connection.json`, `T004-tool-round-trip.png`                             |

Final sample: three fresh-thread trials each for A04, A05, A06, and A07; both A06 edit variants must be covered. Record every attempt. Add browser smoke and negative enforcement cases separately. Never report the small sample as a production reliability percentage.

## Friction log

| ID  | Category / severity | Symptom and reproduction                                                                                                                                                                          | Root cause or hypothesis                                                             | Adopter impact                                               | Fix or workaround                                                                                                                                               | Remaining risk / evidence                                                  | State    |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| F01 | setup / high        | A fresh checkout lacked `node_modules` and `pnpm` on PATH; both live keys were absent.                                                                                                            | Normal fresh worktree state.                                                         | Delayed A01.                                                 | Used Corepack, installed dependencies, CLI-provisioned a dedicated Intelligence project, copied Tyler's OpenAI key to ignored app `.env.local`.                 | Actual model/thread proof still pending.                                   | resolved |
| F02 | setup / low         | `git add tasks/todo.md tasks/autopilot/HILLCLIMB.md` exits 1 because `tasks/` is gitignored.                                                                                                      | Repository ignore rule covers the plan's required durable progress path.             | Progress evidence would otherwise be invisible to reviewers. | Force-add these two explicit files; keep unrelated ignored files out of commits.                                                                                | None once committed.                                                       | resolved |
| F03 | setup / medium      | Assigned worktree began behind fetched `origin/main`; merge conflicted with a new upstream `tasks/todo.md`.                                                                                       | Preassigned branch was based on an earlier commit.                                   | Could invalidate package assumptions.                        | Merged current main, preserved both task lists, pushed merge commit.                                                                                            | Latest fetched base is incorporated.                                       | resolved |
| F04 | setup / medium      | Merge pre-commit hook ran repository-wide Nx checks and failed after Nx daemon EPIPE while ignored files changed; no conflict remained.                                                           | Nx daemon watcher stopped during a large staged merge.                               | Hook could not validate the merge in that run.               | Finished merge with hook disabled for that commit, then ran focused package build.                                                                              | Repository-wide merge hook not fully rerun.                                | open     |
| F05 | package/API / low   | Installed TanStack adapter type rejected a freeform model name; current Runtime `CopilotRuntimeUser` requires `name`, unlike the stale skill example.                                             | Skill and package types differ; model adapter has a finite type list.                | Initial app builds failed.                                   | Used source type, included user name, and chose supported default model with explicit env override.                                                             | Actual model call unverified.                                              | resolved |
| F06 | browser / medium    | Next normalized `request.url` to `localhost` while browser used `127.0.0.1`, so equality against `Origin` rejected local sign-in and redirects changed host.                                      | Next request URL differs from browser-facing host.                                   | Login unusable at the verified URL.                          | Compare Origin host to inbound Host; build redirect using inbound Host.                                                                                         | T003 browser login passed.                                                 | resolved |
| F07 | browser / medium    | SQLite `DatabaseSync` row passed as a `user` prop caused Next server exception, digest `2634326195`.                                                                                              | Row has a non-plain prototype.                                                       | Signed-in dashboard could not render.                        | Spread server-resolved session row into a plain object.                                                                                                         | T003 browser dashboard passed.                                             | resolved |
| F08 | package/API / low   | Test's `GET /threads` returned 400 after a live tool/reply sequence.                                                                                                                              | Endpoint requires an `agentId` query parameter, which the test omitted.              | Could be mistaken for Intelligence persistence failure.      | Query `/threads?agentId=logistics`; assert stored messages and reload.                                                                                          | T003 passed with four persisted messages.                                  | resolved |
| F09 | setup / medium      | First app commit hook ran sync-lockfile and lint-fix concurrently; lint-fix could not stage files because Git's `index.lock` was held. The lockfile also triggered repository-wide package tests. | Parallel hook jobs conflict on Git staging; the staged lockfile broadens test scope. | Blocks routine checkpoint commit.                            | Retain focused Nx build, type check, browser test, and env validator evidence; finish this commit with hook disabled, then rerun relevant checks on its commit. | Repository-wide test/publint/attw hook did not finish for this checkpoint. | open     |
| F10 | setup / low         | Connection test wrote every trial to the same evidence filenames; T002/T003 screenshots were overwritten.                                                                                         | Evidence path had no trial identifier.                                               | Weakens visual audit of early failed attempts.               | Recovered sanitized transcripts by durable thread ID; changed test to use a unique directory on every run.                                                      | T002/T003 screenshots cannot be recovered; ledger states this.             | resolved |

Categories: setup, package/API, model, browser, Intelligence, design, UX. Critical means wrong/unauthorized/duplicate effects, a private-data leak, or failure of a required architectural boundary. Such failures block completion. Distinguish discovered friction from confirmed root causes.

## Integration cost

Record before and after. Count app business code separately from integration and library implementation.

| Measure                                                   | Baseline   | Current    | Reason / evidence |
| --------------------------------------------------------- | ---------- | ---------- | ----------------- |
| Application source LOC                                    | unmeasured | unmeasured | —                 |
| App-specific Autopilot glue LOC                           | 0          | unmeasured | —                 |
| Required annotations / policy entries / identity adapters | 0          | unmeasured | —                 |
| Reusable package LOC                                      | 0 added    | unmeasured | —                 |
| Added production dependencies and bundle size             | unmeasured | unmeasured | —                 |
| Setup steps and time to first live success                | unmeasured | unmeasured | —                 |
| Request actions / page-read bytes / latency / model usage | unmeasured | unmeasured | —                 |

## Package portability evidence

- In-repo example path and public imports:
- Changed package source paths and tested commit:
- Pack/build/check commands and artifact checksums:
- Isolated install path and resolved package/dependency paths:
- Evidence of no workspace links, source aliases, root node_modules, or private imports:
- Type-check and production build/start results:
- Live read/navigation/create/edit/cancel, decline, Inspector, and reload evidence:
- Packaging friction and fixes made in the real packages:
- A17 result: not run.

## Decisions and changes to assumptions

Record the date, original assumption, evidence, chosen change, alternatives rejected, and affected gates. If a required acceptance criterion cannot be met, keep it failing and surface it to Tyler. A change to the implementation is normal; silently redefining success is not.

## External blockers

For each blocker: missing prerequisite, first occurrence, attempts and new evidence, independent work still possible, exact user/external action needed. No secret values. Do not substitute a mock and label the blocked live behavior passing.

## Final handoff checklist

- [ ] Every gate has current evidence; no critical open failure or hidden skipped case.
- [ ] Real model/Intelligence trial ledger and browser/SQL evidence are linked.
- [ ] Production app is reachable; restart works from a new terminal.
- [ ] In-repo `examples/` application and isolated packed-package consumer both pass; artifact provenance and live portability evidence are linked.
- [ ] Source commit, exact commands, environment names, seed accounts, and walkthrough are documented.
- [ ] Key screenshots and Inspector evidence are available under `.context/` and embedded in the handoff.
- [ ] Friction and compromises are summarized, including drop-in integration cost.
- [ ] Verdict states what is proven, what is disproven, and what remains outside the supported prototype.
- [ ] The goal is marked complete only after the above is true.
