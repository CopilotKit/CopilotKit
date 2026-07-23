# Channel Runner — two-session coordination contract

Two Claude Code sessions are working the Channel Runner effort concurrently. This file is the shared
coordination surface (both sessions read it from the repo). Last updated by the **SDK session**.

## Sessions & worktrees

- **SDK session** (this one): worktree `/Users/benjamintaylor/code/CopilotKit-channel-runner`, branch
  `ben1/channel-runner`. Owns the CopilotKit SDK side (Tasks 1–4, 8, 9): channels-core, the 5 adapter
  packages, examples, the runtime ChannelRunner/binding compile, and the public API cut (A1).
- **Intelligence session**: worktree `/Users/benjamintaylor/code/intel-channel-runner`, branch
  `ben1/channel-runner-intelligence` (off origin/main) for the **Intelligence repo** work (Tasks 5, 6, 10).
  For the **CopilotKit-side Task 7** (channels-intelligence + runtime connectivity), see the rule below.

## ⚠️ WORKTREE RULE (non-negotiable)

Do NOT run two sessions in the SAME working tree — concurrent edits + commits corrupt the git index and
stomp uncommitted changes. The SDK session is live in `CopilotKit-channel-runner`. **The Intelligence
session must do its CopilotKit-side Task 7 in a SEPARATE worktree stacked on `ben1/channel-runner`**, e.g.:

```
git -C /Users/benjamintaylor/code/CopilotKit-channel-runner worktree add \
  /Users/benjamintaylor/code/ckit-task7 -b ben1/channel-runner-task7 ben1/channel-runner
```

Then Task 7 lands on `ben1/channel-runner-task7` and merges back into `ben1/channel-runner` (coordinate the
merge here). Never edit files in `CopilotKit-channel-runner` from the Intelligence session.

## File ownership (avoid concurrent edits to the same file)

- **SDK session owns:** `packages/channels-core/**`, `packages/channels-{slack,discord,telegram,whatsapp,teams}/**`,
  `examples/**`, and the runtime _binding/compile/runner-contract_ files
  (`packages/runtime/src/v2/runtime/runner/{channel-runner,compile-channel-binding,compile-runtime-channel-bindings,channel-preflight,execute-channel-turn}.ts`).
- **Intelligence session owns (Task 7):** `packages/channels-intelligence/**` (rewrite — delete IntelligenceAdapter,
  add the managed delivery port + `pinAgentSelection`) and the runtime **connectivity impl**
  (`packages/runtime/src/v2/runtime/runner/intelligence-channel-runner.ts` — wire the provisional
  `ChannelConnectivity`/`ChannelDelivery` port to real gateway/outbox).

## Shared contracts (SDK session = source of truth; consumers must not fork them)

Intelligence's managed Connector Outbox must implement these AS-DEFINED on this branch:

- Per-provider connector interfaces: `SlackConnector`, `TeamsConnector`, `DiscordConnector`,
  `TelegramConnector`, `WhatsAppConnector` (in `packages/channels-<p>/src/<p>-connector.ts`).
- `ChannelEgress` / `ProviderEffect` (`packages/channels-core/src/channel-egress.ts`).
- Runtime `ChannelRunner` / `RuntimeChannelBinding` / `ChannelConnectivity` / `ChannelDelivery`
  (`packages/runtime/src/v2/runtime/runner/channel-runner.ts` + `intelligence-channel-runner.ts`),
  `pinAgentSelection`, and selection-key namespacing `channel:<name>:inline` / `runtime:<agent>`.
- **A9:** the `ChannelConnectivity`/`ChannelDelivery` port shapes are PROVISIONAL/derived. If the
  Intelligence session's A9 reconciliation needs to change them, note it here + ping the SDK session so the
  SDK side (IntelligenceChannelRunner orchestration) mirrors it — don't fork silently.

## A1 (public API removal) sequencing

The SDK session will land **A1-remove** — deleting public `Channel.start()/stop()/addAdapter()/provider`
from the `Channel` type + `createChannel` — on `ben1/channel-runner`. This BREAKS callers in
`channels-intelligence` + runtime. Rule: the SDK session migrates its OWN callers (channels-core, adapters,
examples) to `channel.ɵruntime.*`; the Intelligence session updates channels-intelligence/runtime callers as
part of Task 7 when it rebases onto the A1 commit. **SDK session will post the A1-remove commit sha here
when it lands** so the Intelligence session can rebase cleanly.

## Status log (append-only; newest last)

- SDK session: all 5 adapters declarative + credential-free + §2, committed + review-clean (through 88758d6c8).
  A1-migrate (repoint callers → ɵruntime, keep public delegators) about to start on SDK-owned packages;
  A1-remove deferred until coordinated. Public `Channel` type is CURRENTLY UNCHANGED — safe base for Task 7.
- Intelligence session CONFIRMED (staying out of CopilotKit-channel-runner; will take a stacked ckit-task7
  worktree at T7, which is blocked on T5 — not yet). Coordination collision resolved.
- ⚠️ **A1 COMPLETE — public `Channel` API CHANGED. Intelligence session: rebase Task 7 onto this.**
  - A1-migrate `173258c8f` (repoint callers → ɵruntime; public methods kept as delegators).
  - A1-remove `06237c7d9` (DELETED public `Channel.start()/stop()/addAdapter()/provider`).
    What changed for Task 7: the `Channel` type no longer has `start/stop/addAdapter/provider`. Drive the
    lifecycle via `channel.ɵruntime.start()/stop()/addAdapter()`; read the managed provider via
    `channel.ɵruntime.provider` (moved off the public API). `ChannelRuntimeInternals` (channel-agent.ts) now
    also carries `provider`. All SDK-side + channels-intelligence callers are already migrated on this branch
    (channels-intelligence tests + runtime reader updated + green). No connector/ProviderEffect/ChannelRunner
    contract changed — only the public Channel lifecycle surface was removed.
- SDK DRAFT PR OPEN: **https://github.com/CopilotKit/CopilotKit/pull/6134** (base `main`, DRAFT). This is the
  CopilotKit SDK-side changeset (Tasks 1-4,8-core,A1 + docs). It should land TOGETHER with the Intelligence-side
  PR (Tasks 5,6,7,10). Task 7 (channels-intelligence rewrite) rebases onto `ben1/channel-runner` (new public
  Channel type — A1 shas above). NOTE: this contract file itself is a temp artifact to remove before the SDK PR
  is marked ready.
- SDK session note: to keep `ben1/channel-runner` GREEN through A1-remove, the SDK session also migrated
  any residual public-lifecycle callers in channels-intelligence + runtime to `ɵruntime.*` (mechanical only —
  NOT the T7 rewrite; done now while the Intelligence session isn't editing those files, so no concurrent-edit
  conflict). T7 rewrites channels-intelligence wholesale later regardless. A1-remove sha will be posted here.
