# Enterprise Marketplace Runtime Entitlement Plan

- [x] Port the provider-neutral authenticated Intelligence entitlement read from commits
      `2efcd18928`, `61e5becd75`, and `839a160980` onto current `origin/main`.
- [x] Write a failing client contract test for the current Intelligence response:

  ```ts
  {
    status: "ready",
    entitlement: {
      source: "awsMarketplaceDeploymentLicense",
      active: true,
      features: { analytics: true, memory: true },
      limits: { "threads.max_count": 0 },
      planCode: "enterprise",
    },
  }
  ```

  The parser must reject unknown fields, flat legacy Marketplace bodies, identity fields, AWS
  identifiers, tokens, malformed grants, and invalid diagnostic envelopes.

- [x] Make the client return `ok`, `notSupported`, or `unavailable` without copying response
      bodies into errors. A 404 retains the existing local-license fallback; every other authority
      failure stays fail-closed.
- [x] Write `/info` tests proving active Enterprise authority maps to `valid`, inactive or
      unavailable authority maps to `invalid`, and no plan/features/limits/provider identifiers enter
      the browser payload.
- [x] Run focused client and `/info` tests under Node 22, then the full runtime test, typecheck,
      build, formatting, and `git diff --check` targets.
- [ ] Push a replacement draft PR linked to Intelligence PR #1072, rebase force-free onto the
      latest GitHub `main`, and watch required CI until green.
