# Showcase Railway Operations

## Auto-Updates (Fleet-Wide)

All 41 Railway services have `source.autoUpdates.type = "minor"` with no
schedule restriction (any time, immediately). When a new GHCR `:latest`
digest is pushed, Railway auto-pulls and redeploys without manual
intervention.

CI (`showcase_deploy.yml`) still triggers an explicit `serviceInstanceRedeploy`
after each GHCR push for deterministic health-checking. The auto-update is a
safety net, not the primary deploy path.

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

2. **Add to `showcase_deploy.yml`** `ALL_SERVICES` matrix so CI builds
   and pushes the GHCR image on code changes.

3. **Add to `showcase/ops/config/probes/smoke.yml`** so the service is
   monitored by showcase-ops probes.

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

- **CI still redeploys explicitly**: `showcase_deploy.yml` calls
  `serviceInstanceRedeploy` after GHCR push so the health-check step
  can verify the exact deployment it triggered. Auto-updates are the
  fallback, not a replacement for CI-driven deploy verification.
