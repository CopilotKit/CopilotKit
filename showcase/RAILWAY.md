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
have none. The `minor` services carry a `schedule` array covering all hours,
every day (effectively immediate). When a new GHCR `:latest` digest is pushed,
Railway auto-pulls and redeploys those services without manual intervention.

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
