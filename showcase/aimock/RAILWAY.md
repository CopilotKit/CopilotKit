# showcase-aimock Railway service reference

This document persists the Railway service configuration for `showcase-aimock`
in the repo so the service can be reconstructed from scratch if Railway state
is ever lost. All runtime config (image, startCommand, env vars) lives only in
Railway — this file is the authoritative backup.

> **Where the concrete IDs live.** Because this repo is public, concrete
> Railway service/project/environment IDs and the current public domain are
> **not** stored here. They live in the internal Notion plan (see section 9)
> and can be queried live from the Railway GraphQL API with a valid account
> token. Everywhere below you see `<service-id>`, `<project-id>`,
> `<environment-id>`, or `<public-domain>`, substitute the current value from
> one of those sources.

## 1. What this service is

`showcase-aimock` is a shared mock LLM server that 14+ CopilotKit showcase
services route to via `OPENAI_BASE_URL`. It runs the `@copilotkit/aimock`
container in proxy-only mode and serves fixture-driven responses so demos work
deterministically without burning provider tokens. Unmatched requests fall
through to real upstream providers (OpenAI, Anthropic, Gemini).

## 2. Railway identity

| Field          | Value                                                     |
| -------------- | --------------------------------------------------------- |
| Service name   | `showcase-aimock`                                         |
| Service ID     | `<service-id>` (see Notion plan, section 9)               |
| Project name   | `showcase`                                                |
| Project ID     | `<project-id>` (see Notion plan, section 9)               |
| Environment    | `production`                                              |
| Environment ID | `<environment-id>` (see Notion plan, section 9)           |
| Public domain  | `<public-domain>` (see Notion plan, or Railway dashboard) |

To look these up live from Railway GraphQL with a valid account token:

```graphql
query {
  # List services under the `showcase` project to find the ID.
  projects {
    edges {
      node {
        id
        name
        services {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
  }
}
```

Then drill into the specific service:

```graphql
query {
  service(id: "<service-id>") {
    id
    name
    projectId
    serviceInstances {
      edges {
        node {
          environmentId
          startCommand
          source {
            image
            repo
          }
          domains {
            serviceDomains {
              domain
            }
            customDomains {
              domain
            }
          }
        }
      }
    }
  }
}
```

## 3. Runtime image

- Image: `ghcr.io/copilotkit/aimock:<version>` (the upstream aimock image
  published from `CopilotKit/aimock`, not the legacy `showcase-aimock` wrapper)
- At time of writing (2026-04-23): `1.14.8`
- Available platforms: `linux/amd64`, `linux/arm64` (Railway pulls amd64)
- Version selection: pin to the latest stable aimock release. Bump on a cadence
  that matches showcase stability, not on every aimock publish.

## 4. Fixture sources

Three fixtures are served, fetched remotely at container boot:

- D5 fixture bundle: <https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/showcase/aimock/d5-all.json>
  — 22 fixtures across 9 fixture files covering all 11 D5 feature types. Bundled
  from `showcase/harness/fixtures/d5/*.json`. Must load BEFORE feature-parity
  to win match precedence (D5 uses specific prompts that overlap with
  feature-parity's broader substring matches).
- Smoke fixture: <https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/showcase/aimock/smoke.json>
  — minimal "OK" ping for health verification.
- Feature-parity fixture: <https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/showcase/aimock/feature-parity.json>
  — realistic tool-call / reasoning / streaming responses used by the
  showcase demos.

All files sit in this directory (`showcase/aimock/`). Edits land in the
container on the next Railway restart — aimock fetches fixtures at boot and
caches to disk. Note the `raw.githubusercontent.com` edge cache is ~5 minutes,
so propagation after a merge is usually ~5 min + restart latency.

When updating D5 fixtures, edit the individual files in `showcase/harness/fixtures/d5/`,
then re-bundle into `d5-all.json` by running the merge script or manually
combining the `fixtures` arrays. The bundle must stay in sync.

> **showcase-harness memory budget.** D5 e2e-deep runs up to 4 services x 2
> features = 8 concurrent Chromium contexts (~2.4 GB peak). If OOM occurs,
> reduce `FEATURE_CONCURRENCY` in `e2e-deep.ts` or `max_concurrency` in
> `e2e-deep.yml`.

## 5. Start command

> **Railway overrides Docker ENTRYPOINT.** When `startCommand` is set, Railway
> runs it as the container's command and the image's `ENTRYPOINT` is ignored.
> That means the full `node /app/dist/cli.js` bin invocation must appear
> explicitly in `startCommand` — flag-only invocations fail at boot with
> `The executable --proxy-only could not be found.` This was discovered during
> the Phase 2 deploy when an initial flag-only startCommand was rejected.

```sh
node /app/dist/cli.js \
  --proxy-only \
  --provider-openai https://api.openai.com \
  --provider-anthropic https://api.anthropic.com \
  --provider-gemini https://generativelanguage.googleapis.com \
  --fixtures https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/showcase/aimock/d5-all.json \
  --fixtures https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/showcase/aimock/smoke.json \
  --fixtures https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/showcase/aimock/feature-parity.json \
  --validate-on-load \
  --host 0.0.0.0 \
  --port 4010
```

Flag-by-flag:

| Flag                    | Value                                       | Purpose                                                                                                                          |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `node /app/dist/cli.js` | —                                           | Explicit bin invocation — required because Railway's `startCommand` overrides ENTRYPOINT.                                        |
| `--proxy-only`          | —                                           | Forward unmatched requests to upstream providers instead of failing.                                                             |
| `--provider-openai`     | `https://api.openai.com`                    | Upstream URL for OpenAI passthrough.                                                                                             |
| `--provider-anthropic`  | `https://api.anthropic.com`                 | Upstream URL for Anthropic passthrough.                                                                                          |
| `--provider-gemini`     | `https://generativelanguage.googleapis.com` | Upstream URL for Gemini passthrough.                                                                                             |
| `--fixtures` (×3 URLs)  | Remote URLs above                           | Repeatable flag; each loads one JSON fixture at boot, with cache-fallback on failure. D5 must appear first for match precedence. |
| `--validate-on-load`    | —                                           | Fail-loud on schema errors; allows cache-fallback only when network fetch fails.                                                 |
| `--host`                | `0.0.0.0`                                   | Bind all interfaces so Railway can route to the container.                                                                       |
| `--port`                | `4010`                                      | Hardcoded listen port — matches the legacy wrapper container convention and the fixed                                            |
|                         |                                             | Railway domain routing. Railway injects `$PORT` but the image defaults align with 4010.                                          |

If adopting `$PORT` interpolation in the future, both startCommand and any
upstream `OPENAI_BASE_URL` env vars pointing at this service stay unchanged —
Railway routes the public domain to whatever port the container listens on.

## 6. Environment variables

None are required for the default configuration. Notes:

- `AIMOCK_ALLOW_PRIVATE_URLS=1` would only be needed if fixture URLs ever point
  to private addresses (RFC1918, loopback, etc.). Not applicable here — all
  fixture URLs are public GitHub raw.
- `PORT` is injected by Railway but not read by the current startCommand
  (port is hardcoded to `4010`). Harmless.

## 7. How to reconstruct

If the Railway service is ever lost, recreate with the following recipe.
Substitute `<service-id>`, `<environment-id>`, and `<public-domain>` with the
concrete values from the Notion plan (section 9) or by querying Railway
GraphQL directly.

1. Create a new service in the `showcase` project, `production` environment.
   Easiest path is the Railway UI (New Service → Docker Image), but the
   GraphQL `serviceCreate` mutation works too.
2. Set `source.image` to `ghcr.io/copilotkit/aimock:<latest-stable>` via
   `serviceInstanceUpdate`:

   ```graphql
   mutation {
     serviceInstanceUpdate(
       serviceId: "<service-id>"
       environmentId: "<environment-id>"
       input: { source: { image: "ghcr.io/copilotkit/aimock:1.14.8" } }
     ) {
       id
     }
   }
   ```

3. Set `startCommand` to the block in section 5 (join with spaces, escape as
   needed) via the same `serviceInstanceUpdate` mutation with
   `input: { startCommand: "..." }`. Remember Railway's startCommand overrides
   the image's Docker ENTRYPOINT, so the full `node /app/dist/cli.js` bin
   invocation must appear explicitly in the command string.
4. No env vars needed for default setup (see section 6).
5. Generate a public domain (`serviceDomainCreate` mutation, or the UI's
   "Generate Domain" button). The historical domain pattern is
   `showcase-aimock-production.<railway-edge>` — the current domain is in the
   Notion plan (section 9) and visible in the Railway dashboard.
6. Deploy with `serviceInstanceDeployV2` (do NOT use `serviceInstanceRedeploy`
   — it replays the last snapshot, which may predate the image/startCommand
   change):

   ```graphql
   mutation {
     serviceInstanceDeployV2(
       serviceId: "<service-id>"
       environmentId: "<environment-id>"
     )
   }
   ```

7. Verify (find the current public domain via Railway GraphQL's `domains`
   field or the service's Railway dashboard):

   ```sh
   curl -sS -X POST https://<public-domain>/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer test" \
     -d '{"model":"gpt-4","messages":[{"role":"user","content":"ping"}]}'
   ```

   Expect the smoke fixture's "OK" response. If proxy-fallthrough to OpenAI
   fires instead, the smoke fixture did not load — check boot logs for
   fixture fetch errors.

8. Update any showcase services whose `OPENAI_BASE_URL` points at the old
   URL, if the domain changed during reconstruction.

## 8. Dead code / cleanup

The `Dockerfile` in this directory is the legacy wrapper image builder from
the `showcase-aimock:latest` era. As of Phase 2 (the upstream-image switch),
it is unused — Railway pulls `ghcr.io/copilotkit/aimock` directly. It is safe
to remove in a follow-up PR once the upstream-image switchover has been
stable for a release cycle or two. Leaving it in place for now as a rollback
safety net.

## 9. Related references

- **Notion plan (authoritative source for concrete IDs and current domain):**
  <https://www.notion.so/34a3aa38185281148ae1ff7e2926c9d6>
- aimock release process: `CopilotKit/aimock` repo CHANGELOG
- GitHub raw URL caching: ~5 minute edge cache; hard fixture edits take effect
  on the next Railway restart after the cache expires.
- Railway docs (deploy mutations):
  <https://docs.railway.com/reference/public-api>
