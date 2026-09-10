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

- `inventory.json` and `inventory.md`: inventory and coverage reconciliation.
- `content-defects.json` and `content-audit.md`: source, rendering, and editorial findings.
- Local execution reports and logs: added as checks run. Large or machine-specific logs remain untracked; curated reports retain reproducible commands and outcomes.

Only audit artifacts are being authored at this stage. Product, guide, and example repairs wait until the full defect register is assembled.
