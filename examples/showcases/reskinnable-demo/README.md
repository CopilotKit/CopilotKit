# Reskinnable Demo

One Next.js app whose **entire** experience — brand, theme, layout, pages,
tools, and agent — is reskinnable at runtime. A skin-agnostic **shell** hosts
one **skin** per route segment `/[skin]/...`. The registered set lives in
`src/shell/registry.ts` — today six skins:

- **`banking`** — "Northwind Finance", a corporate banking dashboard. **REST-backed**
  (a live ledger at `/api/banking/v1/*`): transactions, cards, expense policies,
  an approvals queue, filed reports on a canvas, and a teachable
  over-limit-approval flow.
- **`logistics`** — "Meridian", a freight control tower. **REST-backed** (a live
  ledger of its own): exception triage — expedite, reroute, split, or absorb —
  across lanes, inventory, and decisions.
- **`people`** — "Rowan", a People Ops command center. **REST-backed**
  (`/api/people/v1/*`): roster, compensation bands, requests, and onboarding,
  with a teachable out-of-band compensation approval.
- **`commerce`** — "Bellwether", a storefront operations console for a DTC retail
  brand. **REST-backed** (`/api/commerce/v1/*`): orders, catalog, promotions, and
  returns, with a margin ladder and a teachable below-floor markdown approval.
- **`airline`** — "Aeronova", a passenger concierge and the one skin written from
  the TRAVELLER's side rather than an operator's. **REST-backed**
  (`/api/airline/v1/*`): trips, seat selection, loyalty, and disruption rebooking,
  with a teachable fare-exception approval whose gate is entitlement (the fare's
  own conditions) rather than organizational authority.
- **`keel`** — "Keel", Harbor Point Health's knowledge and operations desk.
  **REST-backed** (`/api/keel/v1/*`): a policy register, playbooks and runs on a
  server-settled clock, with a teachable policy-release approval — and the only
  skin with parameterized routes (`knowledge/<docId>`, `runs/<runId>`).

All of them run behind the **same** `Skin` contract on purpose. Every skin gets
the same inset frame, shared chat panel, tool-activity lines, suggestion pills,
and full-region canvas from the shell. What proves the contract is
substrate-agnostic is now the MIGRATION rather than a split: `airline` and `keel`
began as in-memory `useState` stores behind the contract's optional `useData` hook
and both moved onto their own REST ledgers with **no change to the contract and no
change to the shell**. Every skin is REST-backed today, so `useData` currently has
zero implementors — it is still live, just unused.

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
can also go straight to any registered id — `/banking`, `/commerce`, `/keel`, …

### Pinning a deploy to one skin

Set `LOCK_SKIN` to **any registered skin id** and the deploy becomes
single-tenant: the skin is **served at `/`**, with the `/<id>` prefix gone from
the URL space altogether — `LOCK_SKIN=banking` puts the credit cards view at `/`
and the dashboard at `/dashboard`, never `/banking/dashboard`. Every other skin's
segment 404s, as does the locked skin's own prefix, and the switcher collapses to
a static brand badge. Unset — the default — every registered skin stays reachable
under `/<id>` exactly as before.

`src/lib/locked-skin.ts` validates the value against `skinIds` from
`src/shell/skins-config.ts`, so the supported set is exactly the registered set —
currently `banking`, `airline`, `logistics`, `keel`, `people`, `commerce`, and
automatically any skin added later.

Use it for a URL that goes to one prospect, one booth, or one pilot, so the app
reads as a product rather than as a multi-tenant demo harness. An unrecognised id
throws at boot rather than silently 404ing every page. See `.env.example`.

## Adding a skin

Follow the repo-local **reskin skill** in `.claude/skills/reskin/` — three files:
**demo-beats.md**, SKILL.md and templates.md. Read demo-beats.md FIRST: the demo
decides the tools, pages and pills, so discovering the beats afterwards means
rebuilding them. The shape:

1. Scaffold `src/skins/<id>/` and implement each `Skin` contract field.
2. Write `theme.css` (a `.theme-<id>` block re-valuing the shared tokens) and
   side-effect-import it from the skin's `layout.tsx`.
3. Add a server-safe `agent.ts` (no `"use client"`, no JSX).
4. Register in **five** places, all keyed by the identical `id`:
   `src/shell/registry.ts` (client skin), `src/shell/agent-registry.ts` (server
   agent), `LINTED_SKIN_IDS` in `eslint.config.mjs` (or the LOCK_SKIN lint guard
   never looks at your skin), and both `skinIds` (or `LOCK_SKIN=<id>` throws at
   boot) and `skinIdentities` (the locked deploy's `<title>` and
   `<meta name="description">`) in `src/shell/skins-config.ts`. `pnpm test:unit`
   catches a missed append to the last three; the first two it does not — see
   CLAUDE.md § "How to add a skin" for which failure is silent.

See **[CLAUDE.md](./CLAUDE.md)** for the full architecture: the contract field by
field, the client/server boundary, routing/provider composition, the theming
contract, and the shared canvas / OGUI model.

## Demo capabilities

**Every registered skin is demo-complete** against the full beat list in
[`.claude/skills/reskin/demo-beats.md`](./.claude/skills/reskin/demo-beats.md), so
any of them can be walked end to end and any of them is a fair reference. Three
were brought up to that bar by retrofit — `logistics` first, then `airline` and
`keel` — which makes those three the worked examples of raising an EXISTING skin
rather than authoring a new one beat-first (`people` and `commerce` are the
beat-first pair). The per-beat coverage matrix, and the one-line commands that
derive it instead of trusting it, are in [CLAUDE.md](./CLAUDE.md).

### `banking` — the original reference demo

The banking skin doubles as a CopilotKit feature tour. Notable beats:

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

### `people` and `commerce` — authored beat-first

Both were built against the beat list from the start, so each hits every beat
banking does. Their beat maps are written out at the top of their own
`src/skins/<id>/suggestions.ts`, one suggestion pill per beat in demo order.

- **`people`** ("Rowan") — a People Ops command center over `/api/people/v1/*`.
  Its teachable gate is approving an **out-of-band** compensation request (422
  `OUT_OF_BAND`), unlocked by a band exception filed under a justifying code. Two
  out-of-band requests are seeded, so the case taught on stage and the unaided
  replay are different people.
- **`commerce`** ("Bellwether") — a storefront operations console over
  `/api/commerce/v1/*`. Its signature visual is the **margin ladder**: one rail
  per category, each anchored to that category's own margin floor. Its teachable
  gate is approving a markdown that would trade **below the category margin
  floor** (422 `BELOW_MARGIN_FLOOR`), unlocked by a margin waiver filed under a
  justifying code. It is also the reference for a four-lever navigation — status,
  exception class, sort and top-N all arrive from the query string.

### `logistics`, `airline` and `keel` — the retrofits

Each already existed and each was raised to the beat list afterwards, so together
they are the record of what "demo-complete" costs on top of correct wiring. Each
also contributes one thing no other skin does:

- **`logistics`** ("Meridian") — the debugged reference for skin layout chrome and
  the meta-utility strip, plus a server-emitted a2ui canvas. Its teachable gate is
  committing a mitigation **over the planner's approval authority** (403
  `OVER_AUTHORITY`).
- **`airline`** ("Aeronova") — the only PASSENGER-facing skin, and the worked
  example of contributing runtime identity WITHOUT `RuntimeProviders` (one account
  holder, no switcher, so the hook reads no context). Its gate is entitlement — a
  fare whose conditions do not permit the change (422 `FARE_NOT_CHANGEABLE`) —
  lifted only by an exception category MATCHING what the booking's own record
  documents, so the learned procedure is a procedure rather than a memorized code.
- **`keel`** ("Keel") — parameterized routes, and a server-settled clock: run
  progress is settled on every read rather than ticked on a client interval. Its
  gate is who may **release** a policy revision (403 `UNENDORSED_REVISION`).

### Memory & durable self-learning (Intelligence mode)

By default the runtime is pure OSS — the teach-a-workflow loop works within a
single conversation, but nothing persists across threads or restarts. When
`INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, and `INTELLIGENCE_API_KEY`
are all set (`src/app/api/copilotkit/[[...slug]]/route.ts`), the runtime builds
in Intelligence mode: the agent gains durable long-term memory via the
`recall_memory` / `save_memory` tools, so a demonstrated procedure — every skin
has one; `grep -l offerWorkflowRecording src/skins/*/tools.tsx` names them — and
remembered facts/preferences survive across threads and users. The bundled
`docker-compose.yml` and `*-demo.sh` scripts stand up the memory stack; the
`.env.example` documents the required variables.

## Screenshots

The images under `assets/` (`aurora-dashboard.png`, `copilot-chat.png`,
`learning-mode-vignette.png`, `project-preview.png`) illustrate the **banking
skin** specifically — its dashboard, chat panel, and learning-mode recording
vignette. They predate the current shell chrome entirely: there is now an inset
frame of resizable cards with a skin-selector dropdown at the top of the assistant
column, and the app ships six skins rather than two. Treat them as historical
banking-skin illustrations rather than a picture of the app as it looks today.

## Testing

```bash
pnpm lint                # eslint (also the LOCK_SKIN URL-contract guard)
pnpm exec tsc --noEmit   # the ONLY full type-check — see below
pnpm test:unit           # vitest
pnpm build               # production build
pnpm test:e2e            # playwright
pnpm test:e2e:ogui       # open generative UI suite
pnpm test:self-learning  # the memory CI gate
```

There is no `typecheck` script, and **`pnpm build` is not a substitute for
`pnpm exec tsc --noEmit`**: `next build` type-checks only what the app's module
graph reaches, so it never visits the test files, and Vitest transpiles without
type-checking at all. `tsconfig.json` includes them; only `tsc --noEmit` looks.

## Tech

Next.js 16, React 19, Tailwind v4, and workspace (`workspace:*`) builds of
`@copilotkit/react-core`, `@copilotkit/runtime`, `@copilotkit/a2ui-renderer`,
`@copilotkit/core`, and `@copilotkit/shared` (the v2 entry points).
