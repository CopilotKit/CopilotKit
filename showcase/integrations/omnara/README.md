# Omnara Showcase integration

This package registers the published `@ag-ui/omnara` adapter with three
standalone Showcase demos. The canonical standalone starter is
[`examples/starters/omnara`](../../../examples/starters/omnara/README.md).
Read [PARITY_NOTES.md](./PARITY_NOTES.md) before interpreting feature coverage.
The integration is undeployed and hidden from product docs while hosted proof
and shared session configuration remain open.

## Run locally

Use Node.js 22.15 or later. From this directory, run `npm ci`, copy
`.env.example` to `.env.local`, and configure the server-only Omnara values.
Create/apply the profile using the canonical starter's `agent:apply` command;
this package reuses that profile and never creates a provider or changes an
existing profile during a chat. The project must grant access to its model.
Do not use a profile that shadows `change_background`, `get_weather`,
`search_flights`, `get_stock_price`, or `roll_d20` with incompatible definitions.

From the repository root:

```sh
pnpm exec nx run showcase-omnara:dev
```

Open:

- <http://127.0.0.1:3123/demos/agentic-chat>
- <http://127.0.0.1:3123/demos/frontend-tools>
- <http://127.0.0.1:3123/demos/tool-rendering-default-catchall>

`GET /api/health` only reports process liveness. A missing runtime configuration
returns HTTP 503 without revealing credentials. Builds need no credentials.
This local registration uses an in-memory runner and an anonymous demo identity;
public deployment must first supply the verified visitor/session policy and
shared Intelligence wiring tracked in PNI-774.

## Verify

```sh
pnpm exec nx run-many -p showcase-omnara -t test,typecheck,lint,build
pnpm exec nx run @copilotkit/showcase-scripts:validate-manifests
pnpm exec nx run @copilotkit/showcase-scripts:validate-routes
pnpm exec nx run @copilotkit/showcase-scripts:bundle-content
```

From `showcase/`, the unchanged shared probes are:

```sh
bin/showcase test omnara:agentic-chat --d6 --direct
bin/showcase test omnara:frontend-tools --d6 --direct
bin/showcase test omnara:tool-rendering-default-catchall --d6 --direct
```

They require the local Docker infrastructure and a configured Omnara project.
For these D6 checks, explicitly set `OMNARA_PROFILE` in `showcase/.env`
(`.env.local` when running Next.js directly) to
the isolated `copilotkit-showcase-aimock-pni773` profile in the test project.
Confirm its provider is `copilotkit-aimock` / `aimock`, with fixed
`X-AIMock-Context: omnara` and `X-AIMock-Strict: true` headers. Do not use the
interactive demo's default profile unless it has been independently configured
for that strict aimock provider. A real-model profile can incur model charges.
Run the checks serially: the provider cannot yet forward per-run test IDs.
Omnara runs model calls on its hosted service: the local container's
`OPENAI_BASE_URL`/aimock headers do not configure the remote model provider.
PNI-773 must establish public hosted aimock protocol support, strict misses,
fixture context and concurrent isolation before these cells can count as
verified deterministic coverage. No custom mock agent or copied probe is used.

## Demo source and containers

Demo pages, suggestions, styles and backend tool handlers live in this package.
The frontend follows the existing standalone Showcase pages so each demo's
implementation is readable in the Code tab. Tests continue to use the unchanged
shared D6 probes; no probe is copied into this integration.

Use `bin/showcase build omnara` / `bin/showcase up omnara` from `showcase/` to
build and run the integration with the shared Angular and Vue assets.

Docker Compose reads server configuration from `showcase/.env`, matching the
other integrations and the isolation runner. Native Next.js development reads
`showcase/integrations/omnara/.env.local` instead.

Regenerate source bundles from the manifest highlights. `docs_mode` stays
`hidden`; PNI-775 can switch it to `generated` after coverage and publication
checks. Do not hand-edit generated framework data.
