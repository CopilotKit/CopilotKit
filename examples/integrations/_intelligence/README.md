# `_intelligence/` — CopilotKit Intelligence Activation Overlay

This directory is the **framework-agnostic** overlay consumed by `copilotkit init -i` and
`copilotkit add-intelligence`. It contains everything needed to run the CopilotKit Intelligence
stack locally, independent of which framework template your project uses.

## Assets

### `docker-compose.yml`

Starts three services:

- **postgres** — relational store used by the Intelligence runtime
- **redis** — cache and pub/sub broker
- **`ghcr.io/copilotkit/intelligence/composite`** — the all-in-one Intelligence container (app-api
  on 4201, realtime-gateway on 4401, thread-culler, and a db-migrations oneshot)

Bring the stack up with:

```bash
docker compose up -d --wait
```

### `.env.intelligence`

A fragment of environment variables appended to your project's `.env` when you run
`copilotkit add-intelligence`. It wires the scaffolded app to the local stack:

```
COPILOTKIT_LICENSE_TOKEN=
INTELLIGENCE_API_URL=http://localhost:4201
INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4401
INTELLIGENCE_API_KEY=cpk_sPRVSEED_seed0privat0longtoken00
```

`INTELLIGENCE_API_KEY` is pre-seeded with the local-dev value the bundled composite
container expects. To activate Intelligence, set `COPILOTKIT_LICENSE_TOKEN` (server-side
secret, from your CopilotKit dashboard); each base template's runtime wires Intelligence
from that token (see the per-framework dormant wiring below). The stack runs locally once
the token is set.

## Framework independence

This overlay is **not tied to any specific framework template**. The per-framework dormant
runtime wiring (e.g. the `CopilotRuntime` provider, route handler, and hook configuration)
lives in each base template. The overlay only supplies the Docker stack and the env-key
fragment that activates it.
