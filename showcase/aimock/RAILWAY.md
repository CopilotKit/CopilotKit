# showcase-aimock Railway service reference

Tagline: authoritative backup of the `showcase-aimock` Railway service config
(image, startCommand, baked-in fixtures, env vars) and the from-scratch recreate
recipe. Concrete IDs / domains live in the Notion plan (section 9), not in
this public repo.

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
services route to via `OPENAI_BASE_URL`. It runs the `showcase-aimock` wrapper
image (built from `showcase/aimock/Dockerfile`, `FROM
ghcr.io/copilotkit/aimock:latest` with the fixture tree baked in — see §3) in
proxy-only mode and serves fixture-driven responses so demos work
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

> **Auth for `showcase`-project mutations.** Use an account-scoped
> `RAILWAY_TOKEN` (stored in the DevOps `showcase` 1Password item) against the
> Railway GraphQL API with an `Authorization: Bearer <token>` header. The
> Railway CLI session token is **not** authorized for mutations on the
> `showcase` project — the account-scoped token is the working path.

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

- Image: `showcase-aimock`, built by `.github/workflows/showcase_build.yml`
  from `showcase/aimock/Dockerfile`. The Dockerfile is `FROM
ghcr.io/copilotkit/aimock:latest` (the upstream aimock image published from
  `CopilotKit/aimock`) and **bakes the fixture tree into the image** (see
  section 4) — that baked image is what Railway deploys, not the bare upstream
  image.
- Base aimock version: tracks `ghcr.io/copilotkit/aimock:latest`. Pin the base
  tag in the Dockerfile if you need to freeze it for showcase stability.
- Published platform: `linux/amd64` only (`platforms: linux/amd64` in
  `showcase_build.yml`; arm64 is intentionally not published — arm64-only builds
  crash). Railway pulls amd64.

## 4. Fixture sources

Fixtures are **baked into the image at build time**, not fetched remotely. The
`showcase/aimock/Dockerfile` copies three fixture directories from this repo
into the image:

- `shared/` → `/fixtures/shared/` — `common.json` shared responses plus
  `smoke.json` (the minimal "OK" ping used for health verification).
- `d4/` → `/fixtures/d4/` — per-slug fixtures for the D4 demos.
- `d6/` → `/fixtures/d6/` — per-slug fixtures for the D6 demos. The
  `showcase/aimock/d6/<slug>/` tree is the source of truth for these.

The container loads these baked-in directories at boot (see the
`--fixtures /fixtures` flag in section 5). There are no remote fixture URLs and no boot-time fetch —
the old `d5-all.json` / `feature-parity.json` / remote-`smoke.json` bundles
no longer exist (`d5-all.json` was a one-time migration source that was split
into the per-slug `d6/` tree).

To update fixtures, edit the files under `showcase/aimock/{shared,d4,d6}/` and
rebuild the image (a push touching `showcase/aimock/**` triggers
`showcase_build.yml`). Changes land on the next Railway deploy of the rebuilt
image.

> **showcase-harness browser-pool budget.** The harness runs
> `BROWSER_POOL_BROWSERS=3` long-lived Chromium processes with a global
> `BROWSER_POOL_MAX_CONTEXTS=24` context cap (lowered from 40). The D6 peak is
> now 5×4=20 and the D5 e2e-deep peak is 16 (4 services × 4 features), so a
> d6+d5 overlap (20+16=36) exceeds the 24 cap and serializes against it — that
> back-pressure is intended. D5 e2e-deep alone runs up to 4 services × 4
> features = 16 concurrent contexts (~4.8 GB peak). The binding constraint is
> the PID ceiling of 1000, not memory, so contexts (not processes) are the
> scaling knob — tune `BROWSER_POOL_MAX_CONTEXTS` to bound contention, or reduce
> `FEATURE_CONCURRENCY_D6` in
> `showcase/harness/src/probes/drivers/d6-all-pills.ts` / `max_concurrency` in
> `e2e-deep.yml` if a single probe needs throttling.

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
  --fixtures /fixtures \
  --provider-openai https://api.openai.com \
  --provider-anthropic https://api.anthropic.com \
  --provider-gemini https://generativelanguage.googleapis.com \
  --validate-on-load \
  --host 0.0.0.0 \
  --port 4010
```

> **A single `--fixtures /fixtures` loads the whole baked-in fixture tree.**
> The live prod and staging `showcase-aimock` instances both run exactly this
> startCommand — one `--fixtures /fixtures` flag that recurses into
> `/fixtures/shared`, `/fixtures/d4`, and `/fixtures/d6` — and serve fixtures
> correctly. (Confirmed via live Railway GraphQL on both environments.)

Flag-by-flag:

| Flag                    | Value                                       | Purpose                                                                                                                                                             |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node /app/dist/cli.js` | —                                           | Explicit bin invocation — required because Railway's `startCommand` overrides ENTRYPOINT.                                                                           |
| `--proxy-only`          | —                                           | Forward unmatched requests to upstream providers instead of failing.                                                                                                |
| `--provider-openai`     | `https://api.openai.com`                    | Upstream URL for OpenAI passthrough.                                                                                                                                |
| `--provider-anthropic`  | `https://api.anthropic.com`                 | Upstream URL for Anthropic passthrough.                                                                                                                             |
| `--provider-gemini`     | `https://generativelanguage.googleapis.com` | Upstream URL for Gemini passthrough.                                                                                                                                |
| `--fixtures`            | `/fixtures`                                 | Loads the baked-in fixture tree at boot; recurses into `/fixtures/{shared,d4,d6}`. (The flag is repeatable if you ever need to point at individual subdirectories.) |
| `--validate-on-load`    | —                                           | Fail-loud on schema errors at boot.                                                                                                                                 |
| `--host`                | `0.0.0.0`                                   | Bind all interfaces so Railway can route to the container.                                                                                                          |
| `--port`                | `4010`                                      | Hardcoded listen port — matches the legacy wrapper container convention and the fixed                                                                               |
|                         |                                             | Railway domain routing. Railway injects `$PORT` but the image defaults align with 4010.                                                                             |

If adopting `$PORT` interpolation in the future, both startCommand and any
upstream `OPENAI_BASE_URL` env vars pointing at this service stay unchanged —
Railway routes the public domain to whatever port the container listens on.

## 6. Environment variables

None are required for the default configuration. Notes:

- `AIMOCK_ALLOW_PRIVATE_URLS=1` would only be needed if fixtures were loaded
  from private URLs (RFC1918, loopback, etc.). Not applicable here — fixtures
  are baked into the image and loaded from local directories, not over the
  network.
- `PORT` is injected by Railway but not read by the current startCommand
  (port is hardcoded to `4010`). Harmless.
- **No provider API keys.** aimock holds NO `OPENAI_API_KEY` /
  `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`. On the proxy-fallthrough path it does
  NOT authenticate with its own key — it **forwards the client-supplied
  `Authorization` / `x-api-key` header verbatim** to the real provider (see
  §6.1). The real key therefore lives on the CLIENT services, not here.

### 6.1 Upstream auth model + provider-key credential hygiene

aimock cannot own upstream provider auth. In `@copilotkit/aimock`, the
proxy-fallthrough recorder copies every non-hop-by-hop client header straight
to the upstream provider; the header strip-list does NOT include
`authorization` / `x-api-key`, and there is no CLI flag or env var to inject an
aimock-owned provider key (`--provider-openai/anthropic/gemini` set upstream
**URLs** only). So a fixture-miss request reaches the real provider using
**whatever key the calling service sent**.

Because every showcase agent/starter (and the `shell`/`docs`/`dashboard`
frontends) routes provider traffic through aimock, each one must carry a
provider key for those fallthrough requests. To avoid duplicating the SAME real
secret across ~34 services (one scraped env = the real key; rotation = ~34
edits), each provider key is defined **once** as a Railway
**environment-level SHARED variable** and referenced from the services that
need it:

- Create `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` as
  environment-shared variables in each env (staging + prod), sourced from
  1Password — never committed to this repo.
- Each consuming service references `${{shared.<NAME>}}` instead of holding its
  own literal copy. The SSOT (`showcase/scripts/railway-envs.ts`) models this
  per-service via the additive `sharedRefs` field (the provider-key NAMES a
  service resolves from the shared variable), and the Ruby promote preflight
  asserts each listed key resolves to the shared variable rather than a
  distinct per-service literal.

Net: the real secret lives in ONE place per env, rotation is a single edit, and
a scraped service env yields only a `${{shared.*}}` reference token. `aimock`
itself declares no `sharedRefs` — it holds no provider key at all.

> **Rotation.** Rotate the real key in the provider dashboard (e.g. the OpenAI
> account), store the new value in 1Password, and update the single
> environment-shared variable. Never commit a provider key to this repo.

## 7. How to reconstruct

If the Railway service is ever lost, recreate with the following recipe.
Substitute `<service-id>`, `<environment-id>`, and `<public-domain>` with the
concrete values from the Notion plan (section 9) or by querying Railway
GraphQL directly.

1. Create a new service in the `showcase` project, `production` environment.
   Easiest path is the Railway UI (New Service → Docker Image), but the
   GraphQL `serviceCreate` mutation works too.
2. Set `source.image` to the `showcase-aimock` image published by
   `.github/workflows/showcase_build.yml` (the baked image from
   `showcase/aimock/Dockerfile`, which contains the fixture tree — see section 3) via `serviceInstanceUpdate`:

   ```graphql
   mutation {
     serviceInstanceUpdate(
       serviceId: "<service-id>"
       environmentId: "<environment-id>"
       input: { source: { image: "<showcase-aimock-image-ref>" } }
     ) {
       id
     }
   }
   ```

   Deploying the bare upstream `ghcr.io/copilotkit/aimock` instead will boot
   with no fixtures baked in — every request falls through to the proxy.

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
     -d '{"model":"gpt-4","messages":[{"role":"user","content":"Respond with exactly: OK"}]}'
   ```

   The payload matches the `shared/smoke.json` fixture (`userMessage:
"Respond with exactly: OK"`), so expect its `"OK"` response. If
   proxy-fallthrough to OpenAI fires instead, the smoke fixture did not load —
   confirm the deployed image is the baked `showcase-aimock` image and that
   `startCommand` passes `--fixtures /fixtures` (the baked fixture tree).

8. Update any showcase services whose `OPENAI_BASE_URL` points at the old
   URL, if the domain changed during reconstruction.

## 8. The Dockerfile is LIVE

The `Dockerfile` in this directory is **not** dead code — it is the image that
Railway deploys. `.github/workflows/showcase_build.yml` builds it (matrix entry
`showcase-aimock`, with `dockerfile: showcase/aimock/Dockerfile` and context
`showcase/aimock`) and publishes the `showcase-aimock` image. The Dockerfile is
`FROM ghcr.io/copilotkit/aimock:latest` and bakes the fixture tree into the
image:

```dockerfile
FROM ghcr.io/copilotkit/aimock:latest

# Depth-organized fixture directories
COPY shared/ /fixtures/shared/
COPY d4/ /fixtures/d4/
COPY d6/ /fixtures/d6/
```

Do not remove it — deleting it would strip the baked-in fixtures and the
deployed mock would serve nothing (all requests would fall through to the
proxy).

## 9. Related references

- **Notion plan (authoritative source for concrete IDs and current domain):**
  <https://www.notion.so/34a3aa38185281148ae1ff7e2926c9d6>
- aimock release process: `CopilotKit/aimock` repo CHANGELOG
- Fixture propagation: edit files under `showcase/aimock/{shared,d4,d6}/`,
  which triggers `showcase_build.yml` to rebuild the `showcase-aimock` image;
  changes take effect on the next Railway deploy of the rebuilt image.
- Railway docs (deploy mutations):
  <https://docs.railway.com/reference/public-api>
