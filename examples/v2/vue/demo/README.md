# Vue Demo (Nuxt)

Nuxt SSR demo for `@copilotkitnext/vue` with strict parity intent against the React demo.

## Parity policy

- Canonical reference: `examples/v2/react/demo`.
- Match React route set, endpoint contracts, and interaction semantics before adding anything else.
- Mirror React page/file scaffolding as closely as Nuxt allows so route-level diffs stay easy to track.
- No Vue-only workflows or features in this app.
- Temporary gaps are allowed only when Vue package primitives are still being ported.

## Scaffolding rules

- Keep route ownership in `pages/*.vue`, mirroring React's page-level structure.
- Avoid shared wrapper components unless React has an equivalent abstraction.
- When a React primitive is missing in Vue (for example sidebar/popup containers), keep the page scaffold explicit and temporary.

## Current status

- App and server endpoint scaffolding are in place.
- Route skeletons are present for:
  - `/`
  - `/single`
  - `/mcp-apps`
  - `/sidebar`
  - `/popup`
- Endpoint routes are present for:
  - `GET/POST /api/copilotkit/**`
  - `POST /api/copilotkit-single`
  - `GET/POST /api/copilotkit-mcp/**`

## Local setup

1. Add required env vars in `.env` (same as React demo), for example:

```bash
OPENAI_API_KEY=sk-...
```

2. Install deps from repo root:

```bash
pnpm install
```

3. Start the demo:

```bash
pnpm -C examples/v2/vue/demo dev
```
