# AWS Marketplace Runtime Entitlement Projection Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each behavior change and superpowers:verification-before-completion before any completion claim. Execute this plan after the Intelligence runtime-entitlement JSON contract is fixed.

**Goal:** Make the CopilotKit runtime's existing `/info` response reflect the server-authenticated Intelligence deployment entitlement so AWS Marketplace Team deployments enter the existing valid/locked states without exposing seller or AWS license material.

**Architecture:** Extend the existing Intelligence client with one authenticated, schema-checked read of `/api/entitlements/runtime`. The asynchronous `/info` handler prefers this server authority in Intelligence mode, maps active/inactive/unavailable to the existing license status vocabulary, and retains the local offline checker for non-Intelligence deployments and compatibility with an older Intelligence server that returns 404.

**Tech Stack:** TypeScript, fetch, Zod/current repository validation utilities, Vitest, pnpm/Nx.

---

## Execution rules

- Work only in `/Users/maxk/.config/superpowers/worktrees/CopilotKit/aws-marketplace-team-helm-v1-20260820`.
- Do not add Marketplace UI, AWS SDKs, direct AWS calls, token exchange, new browser DTO fields, or changes to normal offline token verification.
- Never surface or retain consumption tokens, client tokens, SKU, key fingerprint, license ARN, or App API internal token in the `/info` payload or error text.
- Add one failing behavior test, run it red for the intended reason, implement minimally, run focused and full runtime suites, then commit and push. Do not amend or force-push.

### Task 1: Add the authenticated Intelligence entitlement read

**Files:**

- Modify: `packages/runtime/src/v2/runtime/intelligence-platform/client.ts`
- Test: `packages/runtime/src/v2/runtime/intelligence-platform/__tests__/client.test.ts`

- [ ] **RED:** Assert a new `getRuntimeEntitlement()` sends the existing server Authorization credential to `/api/entitlements/runtime`, applies the client's normal timeout/abort behavior, and accepts only the sanitized contract:

```ts
type RuntimeEntitlement = {
  organizationId: string;
  source:
    | "managedOrgSubscription"
    | "selfHostedDeploymentLicense"
    | "awsMarketplaceDeploymentLicense";
  active: boolean;
  features: string[];
  limits: Record<string, number>;
  planCode?: string;
  entitlementSource?: string;
};
```

Assert a 404 returns a typed `notSupported` result, non-2xx errors fail closed, malformed/extra credential-shaped fields are rejected or stripped, and no response body containing a secret is copied into thrown messages.

Run:

```bash
fnm exec --using=22 pnpm nx test @copilotkit/runtime -- client.test.ts
```

Expected: FAIL because `getRuntimeEntitlement()` does not exist.

- [ ] **GREEN:** Reuse the client's private request/auth machinery. Parse the narrow DTO defensively and return a discriminated result that distinguishes `ok`, `notSupported`, and `unavailable` without including raw bodies.
- [ ] **VERIFY:** Run the focused client tests and runtime typecheck.
- [ ] **COMMIT:** `git add packages/runtime/src/v2/runtime/intelligence-platform && git commit -m "Read Intelligence runtime entitlement" && git push`.

### Task 2: Project server authority into `/info`

**Files:**

- Modify: `packages/runtime/src/v2/runtime/handlers/get-runtime-info.ts`
- Test: `packages/runtime/src/v2/runtime/__tests__/get-runtime-info.test.ts`

- [ ] **RED:** Cover these exact cases:

| Runtime mode/result                          | Existing `/info` license status |
| -------------------------------------------- | ------------------------------- |
| Intelligence entitlement active              | `valid`                         |
| Intelligence entitlement inactive            | `invalid`                       |
| Intelligence authority unavailable/malformed | `unknown`                       |
| Intelligence endpoint 404                    | current local checker result    |
| Non-Intelligence runtime                     | current local checker result    |

Also assert that plan/features/limits and all provider/AWS identifiers are absent from the browser-facing `/info` response; the PRD requests the existing locked experience, not a new Marketplace UI contract.

Run:

```bash
fnm exec --using=22 pnpm nx test @copilotkit/runtime -- get-runtime-info.test.ts
```

Expected: FAIL because runtime info is resolved only from the local checker.

- [ ] **GREEN:** Make license resolution asynchronous, call the Intelligence client only when that mode is configured, map the server result to the existing status enum, and use local verification only for `notSupported` or non-Intelligence paths. Do not catch authority failures into a permissive fallback.
- [ ] **VERIFY:** Run focused tests, then `fnm exec --using=22 pnpm nx test @copilotkit/runtime`, the runtime typecheck/build targets, and `git diff --check`.
- [ ] **COMMIT:** Commit and push as `Project Intelligence entitlement into runtime info`.

### Task 3: Contract and delivery verification

- [ ] Run the same sanitized JSON fixture against the Intelligence App API route test and this client's parser test.
- [ ] Confirm ordinary offline licensed, offline invalid, and no-license `/info` snapshots are unchanged.
- [ ] Inspect the complete diff for secrets, raw response logging, unrelated API changes, and changes outside runtime scope.
- [ ] Fetch `origin/main`; create a new final-delivery branch at that exact commit, cherry-pick the reviewed commits, and rerun the full runtime suite and build. Push the new branch normally, replace the draft PR, and close the superseded draft so repository history remains truly rebased without force-pushing.
- [ ] Push and open/update a draft PR linked to the Intelligence PR. Watch all required GitHub checks until green; diagnose any failure with superpowers:systematic-debugging and add a failing regression test before the fix.
- [ ] Verify on GitHub that the PR merge base equals current `origin/main` and the branch head is the locally verified commit.
