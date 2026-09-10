# Product-guide content audit

Status: source review complete; runtime and platform verification remain. This
report covers the 26 root product routes recorded in `inventory.json`: Rich
Threads (6), CopilotKit Intelligence (8), and Channels (12). It is source and
local-render evidence only; it does not qualify hosted services, provider
installs, or an external messaging-platform integration.

## Prompt reuse finding

No prompt API or new prompt flow is needed. `RichThreadsSetupPrompt` and
`LearningSetupPrompt` both render the existing `CodingAgentSetupPrompt`, and
both static strings call the shared `createFeatureSetupPrompt` factory. That
factory delegates setup steps to the existing CLI intents `add-rich-threads`
and `add-learning`; raw Markdown expands both cards. The generic Intelligence
CTA uses the same onboarding command family with a per-copy run id. The
Intelligence repository's browser onboarding prompt and CLI prompt service
already use the same coding-agent handoff model. Product-guide changes should
reuse these helpers and point readers at the existing canonical guide/CLI
intent, rather than introduce a second prompt contract.

`CONTENT-GEN-016` is the current exception: the shared Rich Threads overview
ships a separate tracked, hand-written agent prompt. It duplicates setup and
proof instructions that the existing Rich Threads helper deliberately assigns
to the CLI intent.

## Coverage

- Root wrappers and transitive dependencies: 6/6 Threads, 8/8 Intelligence,
  and 12/12 Channels reviewed.
- Shared Thread/Intelligence sources read in full: all eight dependencies.
- Authored Intelligence guides read in full: all eight routes.
- Channels manual full-source review: 12/12. No new source-confirmed defect
  beyond the embedded-demo/platform-verification boundary already recorded.
  Channels are the agreed embedded-demo exception: the Showcase demo is useful
  guide evidence, but it does not replace real Slack or Teams verification.
- The local 362-response route audit establishes delivery status only. It does
  not prove guide semantics, prompt success, hosted Intelligence behavior, or
  channel platform behavior.

## Completed source checks

- All 26 root guides and the eight referenced shared sources were reviewed.
- Setup and API statements were checked against the current local runtime and
  Intelligence contracts without inspecting secret values; source findings are
  recorded in `content-defects.json`.

## Validation still required

- After repairing `CONTENT-GEN-007` and `CONTENT-GEN-008`, rerun their focused
  browser-capture and state-bridge regression probes recorded in
  `candidate-007-008-d6-assessment.md`.
- Verify Channels on real Slack or Teams: install, identity, webhook,
  interactive action, history/reconnect, and error handling. The embedded-demo
  exception does not cover that platform behavior.
