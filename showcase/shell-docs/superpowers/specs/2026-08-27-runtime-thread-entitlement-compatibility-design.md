# Runtime Thread Entitlement Compatibility Design

## Problem

PR #6098 makes active structured Runtime entitlements authoritative for client
feature checks. The existing thread drawers ask for the legacy logical feature
`threads`, but the merged Intelligence producer publishes thread access as the
numeric limit `threads.max_count`. Because missing boolean features fail closed,
valid managed and self-hosted Intelligence entitlements currently lock the
React, Angular, and Vue thread drawers.

The numeric value cannot be interpreted by truthiness: the Intelligence license
catalog defines `0` as unlimited. Presence of the own `threads.max_count` limit
property is the compatibility signal that the structured entitlement carries a
thread grant.

## Considered Approaches

### 1. Map the legacy feature in the shared compatibility adapter

Teach `createLicenseContextValue` that `checkFeature("threads")` maps to the
presence of `limits["threads.max_count"]` for an active structured entitlement.
If the limit is absent, keep the existing exact boolean-feature lookup.

This is the recommended approach. The shared adapter already translates the
new wire authority into the legacy `LicenseContextValue` contract, and all three
frameworks consume it. One mapping therefore fixes React, Angular, and Vue while
preserving older Runtime behavior.

### 2. Change each framework drawer to inspect the numeric limit

React, Angular, and Vue could call `getLimit("threads.max_count")` before falling
back to `checkFeature("threads")`. This is explicit at the UI boundary but
duplicates compatibility logic three times and lets other legacy feature
consumers reach a different decision.

### 3. Add `features.threads` to the Intelligence producer

A follow-up Intelligence change could add a redundant boolean claim. This would
alter the already-merged producer contract, require coordinated rollout, and
still leave #6098 incompatible with the currently deployed response shape.

## Design

Add a narrowly scoped compatibility rule inside `createLicenseContextValue`:

- For an active structured entitlement, `checkFeature("threads")` returns true
  when `threads.max_count` is an own property of the limits record.
- The numeric value, including `0`, does not affect the boolean decision.
- If that limit is absent, the adapter performs the existing exact lookup in
  the boolean features record and defaults missing keys to false.
- Inactive authoritative entitlements continue denying every feature.
- Legacy Runtime responses without structured authority keep their existing
  license-status fallback.

No producer, wire schema, or framework component change is required.

## Testing

Use test-driven development with producer-shaped fixtures:

1. Add Shared tests for managed and self-hosted active entitlements whose thread
   grants exist only as `threads.max_count`, including the unlimited value `0`.
2. Prove the tests fail before changing the adapter.
3. Implement the shared mapping and prove the new Shared tests pass.
4. Replace invented `features.threads` fixtures in the managed React, Angular,
   and Vue coverage with the exact limits-based shape.
5. Run Shared, Core, React Core, Angular, and Vue focused/full Nx targets in
   proportion to the affected surface, plus type checks and diff checks.

## Success Criteria

- Active managed and self-hosted Intelligence entitlements with a published
  `threads.max_count` limit enable thread UI in all three frameworks.
- A missing thread limit and missing legacy boolean grant remain denied.
- A `threads.max_count` value of `0` is enabled as unlimited.
- Inactive and terminal entitlement behavior is unchanged.
- Existing legacy Runtime fallbacks remain unchanged.
