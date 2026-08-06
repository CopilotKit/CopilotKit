# Reskinnable Demo

One Next.js app whose **entire** experience — brand, theme, layout, pages,
tools, and agent — is reskinnable at runtime. A skin-agnostic **shell** hosts
one **skin** per route segment `/[skin]/...`, and ships two of them:

- **`banking`** — "Northwind Finance", a corporate banking dashboard. **REST-backed**
  (a live ledger at `/api/banking/v1/*`): transactions, cards, expense policies,
  an approvals queue, filed reports on a canvas, and a teachable
  over-limit-approval flow.
- **`airline`** — "Aeronova", a passenger concierge. **In-memory** (a seed-backed
  React store): check-in and seat selection, loyalty, and disruption rebooking.

These two run behind the **same** `Skin` contract on purpose: one is REST-backed
and one is in-memory, which proves the contract is substrate-agnostic. (Two more
ship alongside them — `logistics` and `keel`.) Every skin gets the same inset
frame, shared chat panel, tool-activity lines, suggestion pills, and full-region
canvas from the shell.

## What it demonstrates

- A single `Skin` interface (`src/shell/skin-contract.ts`) swapping a whole
  product — brand, theme, nav, pages, tools, agent — with the shell knowing
  nothing domain-specific.
- The theming contract: the shell owns the design-token _names_; each skin owns
  the _values_ via a `.theme-<id>` block, so a reskin is a pure value swap.
- A client/server boundary that keeps each skin's agent out of the browser
  bundle (the agent is server-only and linked to its skin only by a shared id).
- CopilotKit v2 building blocks in a real app: agent context readables,
  generative-UI components, human-in-the-loop, an a2ui report canvas, Open
  Generative UI on the shared canvas, and (in Intelligence mode) durable memory.

## Quick start

```bash
pnpm install          # from the repo root — this is a workspace package
cp .env.example .env  # then fill in OPENAI_API_KEY
pnpm dev
```

Open <http://localhost:3000>. `/` redirects to the default skin
(`banking`; set in `src/shell/skins-config.ts`). This default OSS mode needs only
`OPENAI_API_KEY` — an SSE runtime with an in-memory agent runner, no external
services. Durable cross-thread memory is env-gated (Intelligence mode); see
`.env.example` and the memory section below.

## Switching skins

Use the **skin switcher** — a dropdown at the top of the assistant column, in
the selector card — it lists every registered skin and navigates to `/<id>`
client-side (instant, no reload). Each skin starts in its own fresh thread. You
can also go straight to `/banking` or `/airline`.

### Pinning a deploy to one skin

Set `LOCK_SKIN` to a skin id (`banking`, `airline`, `logistics`, `keel`) and the
deploy becomes single-tenant: the skin is **served at `/`**, with the `/<id>`
prefix gone from the URL space altogether — `LOCK_SKIN=banking` puts the credit
cards view at `/` and the dashboard at `/dashboard`, never `/banking/dashboard`.
Every other skin's segment 404s, as does the locked skin's own prefix, and the
switcher collapses to a static brand badge. Unset — the default — all four stay
reachable under `/<id>` exactly as before.

Use it for a URL that goes to one prospect, one booth, or one pilot, so the app
reads as a product rather than as a four-tenant demo harness. An unrecognised id
throws at boot rather than silently 404ing every page. See `.env.example`.

## Adding a skin

Follow the repo-local **reskin skill** in `.claude/skills/reskin/` (SKILL.md +
templates.md). The shape:

1. Scaffold `src/skins/<id>/` and implement each `Skin` contract field.
2. Write `theme.css` (a `.theme-<id>` block re-valuing the shared tokens) and
   side-effect-import it from the skin's `layout.tsx`.
3. Add a server-safe `agent.ts` (no `"use client"`, no JSX).
4. Register in **both** `src/shell/registry.ts` (client) and
   `src/shell/agent-registry.ts` (server), keyed by the identical `id`.

See **[CLAUDE.md](./CLAUDE.md)** for the full architecture: the contract field by
field, the client/server boundary, routing/provider composition, the theming
contract, and the shared canvas / OGUI model.

## The banking skin's demo capabilities

The banking skin is the richer of the two and doubles as a CopilotKit feature
tour. Notable beats:

- **Components, never walls of text** — transactions, the approvals queue,
  charts, and spend summaries render as real components in the chat rather than
  markdown tables.
- **Screen awareness** — each page publishes what it actually renders via
  `useAgentContext`, so "what's on my screen?" answers truthfully.
- **Human-in-the-loop** — approvals, PIN changes (the agent never sees the
  digits), card actions, and policy exceptions gate on user confirmation.
- **Multimodal** — a paperclip in the chat header (and the Q2 suggestion pill)
  stages a bundled invoice PDF; the agent reads it into a filed report.
- **A report canvas** — `render_report` paints a multi-widget spend report
  full-region on the shared canvas, binding live figures on the client.
- **Teachable self-learning** — an over-limit approval is gated; the agent has
  no saved procedure, watches you clear one, and (in Intelligence mode) recalls
  it on a later thread. See `docs/teach-mode/`.

### Memory & durable self-learning (Intelligence mode)

By default the runtime is pure OSS — the teach-a-workflow loop works within a
single conversation, but nothing persists across threads or restarts. When
`INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, and `INTELLIGENCE_API_KEY`
are all set (`src/app/api/copilotkit/[[...slug]]/route.ts`), the runtime builds
in Intelligence mode: the agent gains durable long-term memory via the
`recall_memory` / `save_memory` tools, so a demonstrated over-limit procedure
(and remembered facts/preferences) survive across threads and users. The bundled
`docker-compose.yml` and `*-demo.sh` scripts stand up the memory stack; the
`.env.example` documents the required variables.

## Screenshots

The images under `assets/` (`aurora-dashboard.png`, `copilot-chat.png`,
`learning-mode-vignette.png`, `project-preview.png`) illustrate the **banking
skin** specifically — its dashboard, chat panel, and learning-mode recording
vignette. They predate the current shell chrome entirely: there is now an inset
frame of resizable cards with a skin-selector dropdown at the top of the assistant
column, and the app ships four skins rather than two. Treat them as historical
banking-skin illustrations rather than a picture of the app as it looks today.

## Testing

```bash
pnpm test:unit          # vitest
pnpm test:e2e           # playwright
pnpm test:e2e:ogui      # open generative UI suite
pnpm test:self-learning # the memory CI gate
```

## Tech

Next.js 16, React 19, Tailwind v4, and workspace (`workspace:*`) builds of
`@copilotkit/react-core`, `@copilotkit/runtime`, `@copilotkit/a2ui-renderer`,
`@copilotkit/core`, and `@copilotkit/shared` (the v2 entry points).
