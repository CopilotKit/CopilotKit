# Vue Demo (Nuxt)

Nuxt SSR demo for `@copilotkit/vue` with strict parity intent against the React demo.

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
  - `/a2ui-demo` (A2UI confirm-button route, parity with React)
  - `/generative-ui` (native generative UI store, parity with React)
- Endpoint routes are present for:
  - `GET/POST /api/copilotkit/**`
  - `POST /api/copilotkit-single`
  - `GET/POST /api/copilotkit-mcp/**`
  - `GET/POST /api/copilotkit-generative-ui/**`

## Generative UI store (`/generative-ui`)

Ask the assistant for a kind of product. It renders product cards into the page, outside the chat.

- `generative-ui/catalog.ts` declares `storeUI`: the components the agent can render, the `cart` state they read, and the `addToCart` and `applyCoupon` functions they call.
- `generative-ui/*.vue` are the components. Each one declares its props with `defineProps`.
- `pages/generative-ui.vue` passes `storeUI` to `CopilotKitProvider` with `:generativeUI`, and places two `GenerativeUISurface` targets: `products` and `recommendations`.
- `server/utils/runtime.ts` (`createGenerativeUIRuntime`) sets `generativeUI: true`, so the agent gets the `render_ui` tool.

To try it, open http://localhost:3000/generative-ui and click **Buy headphones**. The product list changes to the matching headphones. Click **Add to cart** on a card, and the cart badge updates without an agent round trip. The page needs a model key, the same as `/`.

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
