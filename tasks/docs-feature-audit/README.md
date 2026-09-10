# Feature-guide audit

Status: in progress. No guide or example is qualified by this initial record.

## Audit target

- Source revision: `fa6041fc7b08fc5866099769038e43c44c1ce8df`.
- Work branch: `tyler/docs-feature-audit`.
- Initial frontend: React.
- Initial agents: LangGraph Python (`langgraph-python`), LangGraph JS (`langgraph-typescript`), Google ADK (`google-adk`), Strands (`strands`), and the built-in agent (`built-in-agent`).
- Exercise every applicable feature across these five backends to check the shared abstraction. The initial manifest count is 187 declared feature outcomes; the inventory must reconcile that count with actual guides, demo cells, and exceptions.
- Run examples, docs, and behavior tests locally. Use isolated AIMock replay where supported. Record any feature that needs additional credentials or unavailable infrastructure as blocked, never passed.
- Record exact package versions. Compare against latest stable public releases before qualification; repository versions and existing pins are not proof of the current public release.

## Order of work

1. Produce the complete in-scope feature-guide inventory and defect register before repairs.
2. Qualify every applicable feature guide for the five initial agents in React.
3. Expand Angular, Vue, and React Native against LangGraph Python, then the remaining public agents.

Threads and Intelligence demonstrations are in scope and should become Showcase-owned. Channels guides are in scope with an explicit exception to embedded demos; real provider setup still requires verification. General API-reference, conceptual, historical, and quickstart rewrites are outside scope; audit their use as guide dependencies.

## Evidence rules

- Distinguish source findings, executed local behavior, and rendered/local setup evidence.
- Preserve feature IDs, guide units, and selected frontend/agent routes separately.
- Record confirmed defects, missing coverage, intentional limitations, and blocked or untested checks separately.
- A replay-backed test validates the exercised application behavior against its fixture; it does not establish live-provider compatibility.
- Existing accepted failures and a declared runnable flag do not establish a passing result.
- Keep source revision, dependency versions, local endpoints, commands, and result artifacts with each run.
- Use the existing copy-prompt and feature-prompt patterns. Do not introduce a new onboarding flow as part of the audit.

## Artifacts

- [Agreed maintenance plan](system-plan.md): source ownership, guide requirements, qualification, and expansion order.
- [Initial inventory](inventory.md): the selected five-agent React scope and coverage reconciliation.
- [Global feature outline](global-feature-outline.md) and [static routing](global-route-reachability.md): the complete candidate matrix, including undeclared frontend support.
- [Source findings](content-audit.md) and [defect register](content-defects.json): evidence, affected contexts, and limitations for each finding.
- [Additional source review](global-pending-source-units.md): reviewed and pending unique sources beyond the initial batch.
- [Product guide review](product-guide-audit.md): Threads, Intelligence, Channels, and copy-prompt reuse.
- [Selected route checks](full-route-audit.md): local HTML and Markdown delivery, redirects, and visible rendering errors.
- [Host setup](HOST-NATIVE-001.md) and [runtime log](local-runtime-log.md): exact setup, environment blockers, and behavior-run provenance.
- [Runtime totals](host-d6-results.json) and [individual checks](host-d6-check-results.json): executed behavior evidence. Large raw logs remain untracked; curated reports retain reproducible commands and outcomes.
- [Check-count reconciliation](d6-lgp-count-reconciliation.md): why D6 checks, routed demos, and quarantined examples are different counts.

## Baseline interpretation

The current-source local baseline has completed for Built-in Agent, LangGraph Python,
LangGraph JS, and Strands. Google ADK's frontend is blocked by a reproduced route collision.
LangGraph JS requires the existing Webpack launch mode because its checked-in Turbopack dev
command fails compilation. The initial valid runs produced 155 checks: 144 green and 11 red.
The individual-check artifact preserves the initial verdicts; subsequent diagnoses and retries
belong in the runtime log rather than overwriting failed evidence.

These are fixture-backed baseline results, not latest-stable or live-provider qualification.
A green fixture response can miss a data-propagation defect, as the isolated configuration and
recipe diagnostics demonstrate. Final disposition requires the source, setup, rendering, and
behavior evidence together. Global source review and failure diagnosis remain in progress.

Only audit artifacts are being authored at this stage. Product, guide, and example repairs wait until the full defect register is assembled.
