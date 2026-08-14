# CopilotKit Reliable Thread Restore V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Negotiate compact full restore by default while giving apps with mutating subscribers one stable opt-out.

**Architecture:** Core owns a normalized `compactRestore` preference, captures it per connection attempt, and includes the supported projection tuple as an optional extension of the phase-1 restore capability only for null-cursor connect restores. The shared gateway contract pins the tuple fields before either repository implements them; `restore.version` remains `1`. Core, discovered/provisional proxies, clones, and Intelligence delegates all inherit the setting. Development warns once at the public-agent subscription boundary when a subscriber can mutate events while compact restore remains enabled.

**Tech Stack:** TypeScript, Vitest, RxJS, Nx, MDX.

---

### Task 1: Core contract and propagation

**Files:**

- Modify: `packages/core/src/agent.ts`
- Modify: `packages/core/src/intelligence-agent.ts`
- Modify: `packages/core/src/core/core.ts`
- Modify: `packages/core/src/core/agent-registry.ts`
- Modify: `packages/core/src/__tests__/intelligence-agent.test.ts`
- Modify: `packages/react-core/src/v2/hooks/use-agent.tsx`
- Modify: `packages/angular/src/lib/agent.ts`
- Modify: `packages/vue/src/v2/hooks/use-agent.ts`

- [ ] Pin one additive shared contract with `schemaVersion`, `reducerVersion`, `sanitizerVersion`, and `compactorVersion`; preserve `restore: { version: 1, sdkVersion }` for old gateways.
- [ ] Test Core default enabled and explicit opt-out across registered, discovered, and provisional React/Angular/Vue proxies, both clone paths, and Intelligence delegate creation.
- [ ] Test attempt capture through delayed credentials, invalid-cursor retry, and socket credential refresh.
- [ ] Test that compact support is advertised only for connect mode with a null cursor; run mode, valid-cursor reconnect, and explicit opt-out retain legacy behavior.
- [ ] Assert old acknowledgement, unknown acknowledgement, and a new gateway selecting legacy all complete without client failure.
- [ ] Confirm the negotiation assertions fail before implementation.
- [ ] Add `compactRestore?: boolean` to Core, Intelligence agent, and proxied-agent configuration, normalized to `true`, and thread the captured attempt value explicitly to channel parameter creation.
- [ ] Run core tests, typecheck, lint, and build.

### Task 2: Mutation warning

**Files:**

- Modify: `packages/core/src/agent.ts`
- Modify: `packages/core/src/__tests__/agent.test.ts`

- [ ] Test one development warning per public agent for subscribers whose event callbacks can return an `AgentStateMutation`; exclude notification-only callbacks.
- [ ] Test no production warning, no opt-out warning, no duplicate during proxy-to-delegate forwarding, and no behavior change to `super.subscribe()`.
- [ ] Confirm warning tests fail before implementation.
- [ ] Implement advisory wording at public subscriber registration without claiming mutation is certain.
- [ ] Run focused and full core tests.

### Task 3: Public docs and release note

**Files:**

- Modify: `showcase/shell-docs/src/content/docs/premium/intelligence-platform.mdx`
- Modify: `showcase/shell-docs/src/content/docs/premium/self-hosting.mdx`

- [ ] Document default compact full restore, public Core/provider opt-out, clone/proxy propagation, callback-count and `RAW` differences, version fallback, valid-cursor legacy behavior, and the development warning.
- [ ] Keep browser callback semantics with the Core/provider docs; use self-hosting docs only for gateway compatibility and deployment configuration.
- [ ] Use the conventional commit subject for release tooling; do not edit generated package changelogs.
- [ ] Run docs checks and package verification.
