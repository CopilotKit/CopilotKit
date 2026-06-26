# Showcase Railway Operations

Tagline: fleet-wide auto-update config, pending service provisioning, and the
recipe for adding a new Railway service. For day-to-day promote/snapshot/pin
operations see [`./bin/README.md`](./bin/README.md). For aimock-specific
service reconstruction see [`./aimock/RAILWAY.md`](./aimock/RAILWAY.md).

## built-in-agent service

`built-in-agent` → image `showcase-built-in-agent` is fully provisioned in the
`ALL_SERVICES` matrix in `showcase_build.yml` (real `railway_id`
`f4f8371a-bc46-45b2-b6d4-9c9af608bdbf`; `ciBuilt`/`gateValidated` set in
`showcase/scripts/railway-envs.ts`).

Single-service Next.js app (`BuiltInAgent` runs in-process; no separate
agent server). Required env: `OPENAI_API_KEY`. Health probe at
`/api/health`.

The matching `starter-built-in-agent` is intentionally absent from the build
matrix: the starter tooling (`showcase/scripts/extract-starter.ts`,
`provision-starter-fleet.ts`) does not yet support single-service packages, so
the starter will be added in a follow-up PR alongside that support.

## Auto-Updates (Fleet-Wide)

Most image-sourced Railway services have `source.autoUpdates.type = "minor"`
(24 of the 40 services in the production environment as of this writing); the
12 `starter-*` services and a handful of others (incl. `showcase-built-in-agent`,
`harness-workers`, `showcase-ms-agent-harness-dotnet`, `webhooks`) currently
have none. Most of the `minor` services carry no `source.autoUpdates.schedule`
at all, so updates apply immediately whenever a new digest lands; only `aimock`
carries a `schedule` array (covering all hours, every day — operationally
equivalent to no schedule). When a new GHCR `:latest` digest is pushed, Railway
auto-pulls and redeploys those services without manual intervention.

CI (`showcase_build.yml`, "Build & Push") still triggers an explicit
`serviceInstanceRedeploy` (via `redeploy-env.ts`) after each GHCR push for
deterministic health-checking; `showcase_deploy.yml` ("Verify Deploy") then
health-checks that redeployment. The auto-update is a safety net, not the
primary deploy path.

## Adding a New Railway Service

1. **Enable auto-updates** via the GraphQL API:

   ```graphql
   mutation {
     environmentPatchCommit(
       environmentId: "<env-id>"
       patch: {
         "services": {
           "<new-service-id>": {
             "source": { "autoUpdates": { "type": "minor" } }
           }
         }
       }
       commitMessage: "Enable image auto-updates"
     )
   }
   ```

   Or via Dashboard: Settings > Configure Auto Updates > "Automatically
   update to the latest tag" + "At any time, immediately".

2. **Add to `showcase_build.yml`** `ALL_SERVICES` matrix so CI builds
   and pushes the GHCR image on code changes.

3. **No `smoke.yml` edit needed for a normal `showcase-*` service** —
   `showcase/harness/config/probes/smoke.yml` is auto-discovery driven and
   picks up any new `showcase-*` service on the next tick. Only edit its
   `filter.nameExcludes` to EXCLUDE an infra / non-runtime service.

4. **Git-based services**: auto-updates only apply to image-sourced
   services. Skip step 1 for git-deploy services.

## Promoting a Staging-Only Integration to Production

### When this applies

You added an integration **staging-only on purpose** — it ships to staging
first and its prod instance is deferred to "promote later." In the SSOT
(`showcase/scripts/railway-envs.ts`) such an entry looks like the
`showcase-strands-typescript` block did before [PR #5705](https://github.com/CopilotKit/CopilotKit/pull/5705):

- `gateValidated: false`,
- `gateIgnore: true`,
- an `environments:` map containing **only `staging`** (no `prod` block, so no
  prod `serviceInstance` ID exists),
- a `legacyJsonCompat.domains.prod` placeholder pointing at the **borrowed
  staging host**, purely to keep the generated JSON's legacy `{prod, staging}`
  shape (it is never dereferenced by any TS accessor).

This is the worked example to follow — `showcase-strands-typescript` was
promoted exactly this way in PR #5705.

### The critical gotcha (read this first)

**The promote pipeline only promotes image digests to a prod service that
ALREADY exists — it does NOT provision a new prod `serviceInstance`.** Both the
promote workflow (`showcase_promote.yml`, "Showcase: Promote (staging → prod)")
and `bin/railway promote` move the staging-tested `@sha256` digest onto an
existing prod instance; neither has a "create the prod service" step (there is
no provisioning subcommand in `bin/railway`). So a staging-only integration
will **never** appear in prod just by running promote.

Until the prod `serviceInstance` exists, **D6 false-reds the entire column**:
the harness has no `health:<slug>` record for prod, so the per-cell probe is
handed an empty `backendUrl`, Playwright calls `page.goto("/demos/…")` on a
bare relative path, and Chromium rejects it as an invalid URL —
`errorClass=goto-error` on _every_ cell (column-wide, uniform `fail_count`).
The fix is not a code fix; it is provisioning the missing prod instance and
flipping the SSOT gate.

### Ordered checklist

1. **Provision the prod Railway `serviceInstance`.** This is out-of-band (no
   `bin/railway` subcommand covers it; see [`./bin/README.md`](./bin/README.md),
   which defers "new-service provisioning" to this doc). Use the GraphQL
   staged-change primitive, mirroring a peer prod TypeScript showcase service
   (PR #5705 mirrored `showcase-claude-sdk-typescript`):
   - `environmentStageChanges(production, …)` — stage a `services.<svc>` block
     copied from the peer: `source.image` (pinned `@sha256` digest with
     `autoUpdates.minor`), `networking.serviceDomains.<prod-domain>`,
     `build.builder RAILPACK`, and a `deploy` block (reused GHCR
     `registryCredentials`, runtime V2, `healthcheckPath: /api/health`,
     `multiRegionConfig`).
   - `environmentPatchCommitStaged(production, <msg>)` — commit the staged
     change; this **materializes** the prod `serviceInstance` (in PR #5705,
     `8a50728e-6119-43c4-b59c-d9535b6717a4`).
   - Deploy it (`serviceInstanceDeployV2`) and poll the deployment to
     `SUCCESS`.

2. **Edit the SSOT (`showcase/scripts/railway-envs.ts`)** — convert the entry
   to the dual-env `showcase-strands` shape:
   - add a `prod` env block under `environments:` with the **real**
     `instanceId`, `healthcheckPath: "/api/health"`, the prod `domain`, and
     `probe: true`;
   - set `gateValidated: true` (per the `gateValidated` doc in that file, new
     SSOT services MUST land `gateValidated: true`; `gateIgnore` is only for
     "deliberately-untracked third-party / domainless / single-env services" —
     a prod-promoted demo is none of those);
   - **remove** `gateIgnore: true`;
   - **remove** the `legacyJsonCompat` prod-domain placeholder (the borrowed
     staging host);
   - update the leading comment to reflect the dual-env state.

   See the PR #5705 diff on this file for the exact before/after.

3. **Regenerate the derived artifacts and run the gate:**
   - `npx tsx showcase/scripts/emit-railway-envs-json.ts` — regenerate
     `railway-envs.generated.json` (CI verifies with `--check`).
   - Regenerate the golden fixture
     `showcase/scripts/__tests__/fixtures/railway-envs.golden.json` so the new
     prod `(service, env)` pair is captured — this is an **intentional**
     behavior change, not a refactor regression
     (`railway-envs.golden.test.ts` is a behavior-preservation guard).
   - `npx tsx showcase/scripts/sync-promote-service-options.ts` — regenerate
     the `showcase_promote.yml` workflow_dispatch dropdown so the slug becomes
     a promote target (CI verifies with `--check`).
   - `npx tsx showcase/scripts/verify-railway-image-refs.ts` — run the image-ref
     gate; with `gateValidated: true` it now validates the prod pin too.
   - Run the scripts test suite (`pnpm exec vitest run` from `showcase/`),
     including `verify-railway-image-refs.test.ts` and `redeploy-env.test.ts`,
     whose gate-target / redeploy-scope counts and "staging-only" comments
     change when the entry flips dual-env.

4. **Secrets.** A prod TypeScript integration gets its provider keys
   (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, and `OPENAI_BASE_URL` for
   aimock-routed agents) from the **prod env's variable set**, mirroring the
   peer prod service's config — set them on the new prod instance, never inline
   a secret value in the SSOT or in a commit. If the agent routes 100% to
   aimock (the `serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }]`
   case), `OPENAI_BASE_URL` points at the **prod** aimock origin and the
   `OPENAI_API_KEY` is the non-secret `sk-aim…` aimock placeholder — so no real
   prod secret is sourced. The `OPENAI_BASE_URL` service-ref is asserted
   prod→prod by the promote preflight (never copied across envs).

5. **Verify GREEN.** After the prod instance is up:
   - prod `/api/health` returns **200**
     (`https://showcase-<slug>-production.up.railway.app/api/health`);
   - the prod PocketBase `health` collection gains a `health:<slug>` record
     (`dimension="health"`, `status:200`, a real prod `url`);
   - the D6 column flips on the prod harness's **next hourly
     `d6-all-pills-e2e` tick** (runs at `:40`). The probe needs the harness to
     have discovered the new prod health record first, so expect up to ~1 hour
     of lag — the column stays red until the next tick even though the service
     is healthy. Don't panic about that lag; confirm health (200 + the
     PocketBase record) as the discriminating GREEN signal, then let the tick
     clear the cells.

Once promoted, run the digest promote itself the normal way —
`showcase_promote.yml` (now listing the slug) or `bin/railway promote`; see
[`./bin/README.md`](./bin/README.md) "Worked example: promote staging →
production".

### CVDIAG instrumentation + per-request `X-AIMock-Strict` forwarding (REQUIRED)

Any integration being **added or promoted** MUST also be wired for
flap-observability (CVDIAG) and per-request header forwarding, or its D6 column
can silently degrade. Two non-optional steps:

1. **CVDIAG backend instrumentation.** Add the slug to
   `_CVDIAG_TS_INTEGRATIONS` in `scripts/cli/cmd-cvdiag-stage-ts.sh` and run
   `bin/showcase cvdiag-stage-ts` (then `--check`, which must exit 0 with zero
   drift). This stages the co-located `src/cvdiag/` emitter into the
   integration's standalone build context. Then WIRE the emitter so backend
   `backend.*` boundaries actually emit and persist to the `cvdiag_events`
   PocketBase collection (set `CVDIAG_BACKEND_EMITTER`, `CVDIAG_PB_URL`,
   `CVDIAG_WRITER_KEY` on the prod env's variable set, mirroring the local
   compose service). Without backend rows, `bin/showcase cvdiag classify` has
   nothing to classify and a flap cannot be diagnosed.

2. **Per-request `X-AIMock-Strict` forwarding.** The probe sends
   `X-AIMock-Strict: true` (+ `x-test-id`, `x-aimock-context`, `x-diag-*`) on
   every request so a fixture MISS becomes a HARD FAILURE instead of silently
   proxying to the real provider. The integration's outbound LLM call to aimock
   MUST carry that header through. If it does not, a fixture miss falls through
   and a stale/drifted answer renders as a PASS — the classic symptom is the
   **D3 column flapping** (an e2e cell intermittently going amber/red) because
   the rendered answer is non-deterministic real-provider output rather than the
   pinned fixture. Forward ONLY headers PRESENT inbound (never hardcode strict
   on) so ordinary demo traffic still proxies normally.

**Two-process caveat.** For a two-process integration (a Next proxy route in
front of a separate agent process — e.g. `strands-typescript`,
`claude-sdk-typescript`, where the Next route is a bare `HttpAgent` proxy and
the model call happens in the agent process), the CVDIAG emitter AND the header
forwarder must live **agent-side**, not on the Next route. Wrapping the Next
route would instrument the proxy hop, not the real model call, and the AG-UI
transport may drop inbound `x-*` before `agent.run()` (e.g.
`@ag-ui/aws-strands` reads only `req.body` + `accept`). The seams are: (a) the
Next route forwards inbound `x-*` onto the proxy POST (HttpAgent `fetch`
option + an `AsyncLocalStorage` snapshot), and (b) the agent process recovers
them via a middleware mounted before the framework handler, seeds an
`AsyncLocalStorage`, and the model client's `fetch` override injects them on the
outbound aimock call. See `integrations/strands-typescript/src/agent/{header-forwarding,cvdiag-backend-strands}.ts`
for the worked two-process example, and `integrations/built-in-agent/src/lib/header-forwarding.ts`
for the in-process precedent.

**Two-process Docker staging (REQUIRED).** When the separate agent process
imports the co-located emitter directly (e.g. `../cvdiag/cvdiag-emitter.js`),
the integration's `Dockerfile` MUST `COPY src/cvdiag` into the runner stage so
the emitter ships in the image — e.g. `COPY --chown=app:app src/cvdiag
./src/cvdiag` immediately after the `COPY --chown=app:app src/agent ./src/agent`.
Single-process integrations (`mastra`, `langgraph-typescript`,
`claude-sdk-typescript`) get the emitter via Next's `.next` bundling and do NOT
need this extra COPY. **Symptom if omitted:** the image passes local d6 — where
`bin/showcase cvdiag-stage-ts` materializes the emitter into the working tree —
but **crashes at boot in Docker/staging with `ERR_MODULE_NOT_FOUND:
.../src/cvdiag/cvdiag-emitter.js`**, so the agent never starts and the D6 column
never renders.

> **Related:** for the _single-shot_ "create prod service → go live"
> bring-up (where prod is provisioned immediately, with no staging-first
> phase), see [`./INTEGRATION-CHECKLIST.md`](./INTEGRATION-CHECKLIST.md) §B.
> This section is the **staging-first → promote-later** counterpart.
>
> TODO: `INTEGRATION-CHECKLIST.md` §B.3 still names `showcase_deploy.yml` as
> the build/push workflow to edit; the build/push matrix has since moved to
> `showcase_build.yml` ("Build & Push"), with `showcase_deploy.yml` now the
> staging verify gate. Correct §B.3 in a follow-up.

## harness-workers Replica Count (Worker Provisioning)

The `harness-workers` fleet provisioning is tracked in the SSOT at
`showcase/scripts/railway-envs.ts` under the `harness-workers` entry's
`workerProvisioning` field. The `railway-envs.generated.json` snapshot
captures these values for CI drift detection.

### Worker model (1-worker-per-replica)

Railway runs **one worker process per replica container** (keyed on `HOSTNAME`).
There is no per-process forking. The live worker count equals `numReplicas`
strictly 1:1. `HARNESS_POOL_COUNT` is an **informational-only** control-plane
hint — it does NOT fork additional workers. The authoritative per-worker
concurrency knob is `BROWSER_POOL_MAX_CONTEXTS`.

### Current declared values (live reality as of 2026-06-26)

| Env     | `numReplicas` (live workers) | `BROWSER_POOL_MAX_CONTEXTS` |
|---------|------------------------------|-----------------------------|
| prod    | 3                            | 40                          |
| staging | 6                            | 40                          |

**Staging config-field drift**: the Railway staging replicas config field was
observed as `2` at audit time, but `6` instances were live. The SSOT records `6`
(live reality). Follow-up: update the Railway staging replicas config field to 6.

**Prod/staging parity**: prod runs 3 replicas vs. staging's 6. Bringing prod
to parity is a deliberate one-field change (`numReplicas: 3 → 6`) that is
deferred to a follow-up operational item.

### SSOT fields

- `workerProvisioning.{prod,staging}.numReplicas` — authoritative worker count
  (= Railway replica count, 1:1). This is the ONLY field to update when
  changing the replica count.
- `workerProvisioning.{prod,staging}.BROWSER_POOL_MAX_CONTEXTS` — per-worker
  Playwright context budget.
- `workerProvisioning.{prod,staging}.HARNESS_POOL_COUNT` — INFORMATIONAL ONLY;
  records what the `HARNESS_POOL_COUNT` env var is set to on Railway for audit
  visibility. Never use this as a worker count or fork factor.

### Applying a replica count change (MANUAL)

The `emit-railway-envs-json.ts` emitter and `bin/railway` tooling are
**VERIFY-ONLY** with respect to `numReplicas` — they do not write replica counts
to Railway. To change the replica count:

1. Change the `numReplicas` value in `railway-envs.ts` (SSOT).
2. Regenerate the snapshot: `npx tsx showcase/scripts/emit-railway-envs-json.ts`
3. Commit both files (`railway-envs.ts` + `railway-envs.generated.json`).
4. Apply the change to Railway manually via the Railway Dashboard (Service >
   Settings > Replicas) or the Railway GraphQL API.

The CI drift gate (`showcase/scripts/__tests__/harness-workers-provisioning.test.ts`)
will fail if `railway-envs.ts` and `railway-envs.generated.json` disagree on
`numReplicas`, catching a forgotten regeneration step.

## Environment IDs

- Project: `<project-id>`
- Environment: `<env-id>`
- Token: `~/.railway/config.json` -> `.user.token`

## Known Quirks

- **Polling frequency**: Railway's auto-update polling interval is
  undocumented. Expect seconds to low minutes after a GHCR push.

- **API surface**: `environmentPatchCommit` is the only programmatic
  way to configure auto-updates. Typed GraphQL mutations
  (`ServiceSourceInput`) do not expose `autoUpdates`.

- **`source.autoUpdates.type` values**: `disabled`, `patch`, `minor`.
  We use `minor` (any semver-compatible tag change, including `:latest`
  digest changes).

- **`source.autoUpdates.schedule`**: array of
  `{day, startHour, endHour}`. Omit entirely for "any time, immediately".

- **CI still redeploys explicitly**: `showcase_build.yml` triggers
  `serviceInstanceRedeploy` (via `redeploy-env.ts`) after the GHCR push, and
  `showcase_deploy.yml` ("Verify Deploy") health-checks that redeployment so it
  can verify the exact deployment it triggered. Auto-updates are the fallback,
  not a replacement for CI-driven deploy verification.
