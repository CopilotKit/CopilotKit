# CopilotKit Reliable Thread Restore V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Negotiate compact full restore by default while giving apps with mutating subscribers one stable opt-out.

**Architecture:** Core owns a `compactRestore` preference, captures it per connection attempt, and includes the supported reducer/version tuple in the phase-1 restore capability. Clones and proxied agents inherit the setting. Development warns when a mutation-capable subscriber is added while compact restore remains enabled.

**Tech Stack:** TypeScript, Vitest, RxJS, Nx, MDX.

---

### Task 1: Core contract and propagation

**Files:**

- Modify: `packages/core/src/agent.ts`
- Modify: `packages/core/src/intelligence-agent.ts`
- Modify: `packages/core/src/__tests__/intelligence-agent.test.ts`

- [ ] Test default enabled, explicit opt-out, attempt capture, clone propagation, proxied-agent propagation, old-gateway fallback, and valid-cursor legacy behavior.
- [ ] Confirm the negotiation assertions fail before implementation.
- [ ] Add the smallest public configuration surface and join capability tuple.
- [ ] Run core tests, typecheck, lint, and build.

### Task 2: Mutation warning

**Files:**

- Modify: `packages/core/src/intelligence-agent.ts`
- Modify: `packages/core/src/__tests__/intelligence-agent.test.ts`

- [ ] Test one development warning for mutation-capable subscribers with compact restore enabled, no claim that mutation is certain, no production warning, and no warning when opted out.
- [ ] Confirm warning tests fail before implementation.
- [ ] Implement warning dedupe at subscriber registration without changing subscriber behavior.
- [ ] Run focused and full core tests.

### Task 3: Public docs and release note

**Files:**

- Modify: `showcase/shell-docs/src/content/docs/premium/intelligence-platform.mdx`
- Modify: `showcase/shell-docs/src/content/docs/premium/self-hosting.mdx`
- Modify: `packages/core/CHANGELOG.md`

- [ ] Document default compact full restore, opt-out, clone/proxy propagation, callback-count and `RAW` differences, version fallback, valid-cursor legacy behavior, and the development warning.
- [ ] Run docs checks and package verification.
