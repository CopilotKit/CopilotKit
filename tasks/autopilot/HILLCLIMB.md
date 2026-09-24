# Autopilot prototype: progress and evidence

Copy this into `tasks/autopilot/HILLCLIMB.md` when implementation begins. This is a starting template, not an implementation result. All checks begin unrun.

## Goal and constraints

Deliver the playable Next.js/SQLite logistics SaaS app described in `AGENT_PLAN.md`, using real CopilotKit packages, live BuiltInAgent, existing Intelligence, and runtime-side SDK changes. Create, edit, and cancel orders with approval; discovery and execution stay in the browser. Complete every acceptance gate. Do not change the Intelligence service or replace the live path with fakes.

Required locations: application and verification scripts in this repo's `examples/v2/autopilot-logistics`; reusable source changes in the actual `packages/*`. Prove both workspace execution and clean installation of packed package artifacts. The isolated temporary consumer is only a test artifact, not a separate implementation.

Plan location: `.context/autopilot-prototype/AGENT_PLAN.md` (local, gitignored handoff).
Working tree / branch: `/Users/tylerslaton/conductor/workspaces/CopilotKit/istanbul` / `product-eng-sync-action-items`.
Fetched base / tested commit: `origin/main` fetched 2026-09-24; starting HEAD `5f3ebb0066e17c28339795b5ac21c572a1243eda`.
Package resolution / model ID: source package manifests are 1.73.0; dependencies not installed yet; intended live model pending configuration.
Packed artifacts / checksums / isolated consumer result: not recorded.
Live app URL / process / restart command: not started.
Credential readiness (names and presence only): `CPK_INTELLIGENCE_API_KEY` and `OPENAI_API_KEY` absent from process environment; local example `.env.local` not created yet. User asked to configure local file, without sending secrets in chat.

## Current evidence

- Required gates with current passing evidence: **0 / 18**.
- Unresolved critical failures: **unknown — baseline not run**. Live external prerequisites currently absent.
- Live trials passed / attempted: **0 / 0**.
- Last known working checkpoint: **none**.
- Current highest-risk unknown: **real BuiltInAgent frontend-tool round trip through Intelligence**.
- Next experiment: **A01 connection and frontend execution baseline**.
- Overall state: **baseline in progress**.

Allowed gate states: not run, failing, passing, stale, externally blocked. Partial work belongs in the notes, not in the passing count. Passing needs evidence on the current relevant code. Do not change the denominator or delete failures to improve the score.

## Scoreboard

| Gate | Requirement                                                            | State   | Tested commit | Evidence / failure / next check |
| ---- | ---------------------------------------------------------------------- | ------- | ------------- | ------------------------------- |
| A01  | Real packages, BuiltInAgent, model and Intelligence                    | not run | —             | —                               |
| A02  | Runtime activation and UI agent selection                              | not run | —             | —                               |
| A03  | Manual SaaS and persistent SQL                                         | not run | —             | —                               |
| A04  | Page explanation and navigation                                        | not run | —             | —                               |
| A05  | Create through discovered controls                                     | not run | —             | —                               |
| A06  | Edit details and status through discovered controls                    | not run | —             | —                               |
| A07  | Cancel through declared action, reused approval                        | not run | —             | —                               |
| A08  | User management and server-enforced roles                              | not run | —             | —                               |
| A09  | Bound approval, stale identity and replay rejection                    | not run | —             | —                               |
| A10  | Alternate tool entry points cannot bypass checks                       | not run | —             | —                               |
| A11  | Manual takeover and cancellation                                       | not run | —             | —                               |
| A12  | Request budget and concurrent agents/tabs                              | not run | —             | —                               |
| A13  | Private data, prompt injection and tenant isolation                    | not run | —             | —                               |
| A14  | Reload and uncertain-effect recovery                                   | not run | —             | —                               |
| A15  | Failure handling and manual fallback                                   | not run | —             | —                               |
| A16  | Themed controls, generated card and Inspector                          | not run | —             | —                               |
| A17  | Minimal integration, second form, and isolated packed-package consumer | not run | —             | —                               |
| A18  | Reproducible live handoff                                              | not run | —             | —                               |

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

## Live trial ledger

One row per attempt, including failures and retries. Distinguish a new independently seeded trial from an automatic continuation of one request.

| Trial | Gate / prompt | Commit / model / browser | Thread / request | Expected DB effect | Actual effect | Outcome / time / usage | Evidence |
| ----- | ------------- | ------------------------ | ---------------- | ------------------ | ------------- | ---------------------- | -------- |
| none  | not run       | —                        | —                | —                  | —             | —                      | —        |

Final sample: three fresh-thread trials each for A04, A05, A06, and A07; both A06 edit variants must be covered. Record every attempt. Add browser smoke and negative enforcement cases separately. Never report the small sample as a production reliability percentage.

## Friction log

| ID  | Category / severity | Symptom and reproduction                                                                                                                    | Root cause or hypothesis                                                          | Adopter impact                                               | Fix or workaround                                                                                            | Remaining risk / evidence                                     | State    |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------- |
| F01 | setup / high        | A fresh checkout lacks `node_modules`; `pnpm` is not on PATH but `corepack pnpm` works. Live key names are absent from process environment. | Normal fresh worktree state; credential availability is pending user local setup. | Delays A01 and all live gates.                               | Use Corepack for install; continue independent implementation; check `.env.local` when app directory exists. | Live results cannot be claimed until configured and verified. | open     |
| F02 | setup / low         | `git add tasks/todo.md tasks/autopilot/HILLCLIMB.md` exits 1 because `tasks/` is gitignored.                                                | Repository ignore rule covers the plan's required durable progress path.          | Progress evidence would otherwise be invisible to reviewers. | Force-add these two explicit files; keep unrelated ignored files out of commits.                             | None once committed.                                          | resolved |

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
