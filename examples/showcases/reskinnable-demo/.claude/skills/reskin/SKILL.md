---
name: reskin
description: >-
  Author a NEW skin for the reskinnable-demo app. A skin is a self-contained
  domain plugin under src/skins/<id>/ that implements the frozen `Skin` contract
  (src/shell/skin-contract.ts) to swap the app's entire experience — brand,
  theme, layout, pages, tools, data, and agent. Use when the user says "add a
  skin", "create a skin", "new skin", "reskin the app", "make a <domain> skin",
  or wants the app re-themed as a new product. Do NOT use for editing the shell
  itself (src/shell/**), the shared token vocabulary (src/app/globals.css), or
  the two shipped skins unless explicitly asked.
---

# Authoring a reskinnable-demo skin

This app hosts one skin-agnostic **shell** (`src/shell/`) that renders one
**skin** per URL segment `/[skin]/...`. A skin is a domain plugin living entirely
under `src/skins/<id>/`. Its ONLY inbound dependency is the frozen `Skin`
contract in `src/shell/skin-contract.ts` — that is what lets skins be authored
in isolation without touching shared code.

To add a skin you (1) implement the `Skin` contract in `src/skins/<id>/`,
(2) put its **server-only** agent in `src/skins/<id>/agent.ts`, and (3) register
both — the client skin in `src/shell/registry.ts` and the agent in
`src/shell/agent-registry.ts`, keyed by the identical `id`.

> Before writing anything, re-open `src/shell/skin-contract.ts` (the source of
> truth) and read the two shipped skins as worked references:
> `src/skins/airline/` (the minimal end — in-memory data, no canvas surface) and
> `src/skins/banking/` (the maximal end — REST-backed, with `Providers`,
> `CanvasSurface`, `sandboxFunctions`, `chatHeaderActions`, `onSuggestionSelect`).
> Those files win on any conflict with this skill.

---

## ⚠️ CRITICAL: the client / server boundary

**The AGENT is server-only and is NOT part of the client `Skin` contract.**
`@copilotkit/runtime` must never be bundled client-side.

- Each skin puts its agent in a server-safe `src/skins/<id>/agent.ts` with
  **NO `"use client"` and NO JSX** — just:
  `export const <id>Agent = () => new BuiltInAgent({ ... });`
- The client `skin.tsx` **NEVER imports `agent.ts`.** The only link between them
  is the shared `id` (`id === agentId`).
- The client skin registers in `src/shell/registry.ts` (`SkinRegistry`); the
  agent registers separately in `src/shell/agent-registry.ts` (`agentRegistry`,
  as `{ createAgent, identifyUser? }`). Two registries, one id.

**Theming is a per-skin `theme.css`, never the shared globals.** The shell owns
the token _vocabulary_ in `src/app/globals.css` (`@theme inline` + the semantic
utilities `bg-surface`, `text-ink`, `border-hairline`, `shadow-soft`, `bg-brand`,
…). Do **not** edit `globals.css`. Instead create `src/skins/<id>/theme.css`
containing a single `.theme-<id> { … }` block that **re-values** the shared CSS
variables, and import it as a **side-effect** from the skin's `layout.tsx`
(`import "./theme.css";`). Your `skin.themeClass` must equal `"theme-<id>"` so the
shell applies your block. Never invent new token names — only re-value existing
ones.

**Dark mode is an explicit opt-in — `--nw-dark-capable: 1`.**
`src/hooks/use-theme.ts` forces any skin WITHOUT that flag to light and ignores
the stored dark preference, so a skin that writes a `.dark .theme-<id>` block but
forgets the flag stays stuck in light. To support dark you must do BOTH: set
`--nw-dark-capable: 1` on the `.theme-<id>` root AND ship a `.dark .theme-<id>`
block (which re-values only surfaces / ink / semantic tokens and lets the brand
ramp and `--radius` inherit). Omit both to stay light-only — a legitimate choice
(airline does exactly that). If you kept the theme toggle in your layout, note
it is a **dead control** until this flag and the dark block both exist.

**OGUI renders full-region on the shared canvas.** A `generateSandboxedUi` call
becomes an `open-generative-ui` activity that the shell renders full-region on
the canvas via the workspace `OpenGenerativeUIActivityRenderer` (this build ships
it). A skin does **not** supply an OGUI renderer — it only contributes
`sandboxFunctions?` + `designSkill`, which the shell wires onto the provider. (An
a2ui _report_ surface is different: a skin renders its own via the optional
`CanvasSurface`.)

**An a2ui `CanvasSurface` must be fed by a SERVER tool, never a client one.** If
your skin ships a `CanvasSurface`, emit its `{ [A2UI_OPERATIONS_KEY]:
buildOps(spec) }` payload from a **server-side `defineTool` on the `BuiltInAgent`
in `agent.ts`** — not from a client `useFrontendTool`. The a2ui middleware only
converts that payload into an `a2ui-surface` activity when it observes it in an
in-stream `TOOL_CALL_RESULT` event, which a client frontend-tool result never
produces — do it client-side and the canvas stays permanently blank. Both banking
(`render_report`) and logistics (`renderBrief`) do it server-side; the `agent.ts`
template shows the shape.

---

## The `Skin` contract, field by field

Quoted from `src/shell/skin-contract.ts` (the frozen interface). Diff your object
against that file; it wins.

**Required:**

| Field         | Type                                            | Purpose                                                                                         |
| ------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`          | `string`                                        | Stable id — **MUST equal the route segment AND the agent id.**                                  |
| `identity`    | object (below)                                  | Brand identity the shell renders.                                                               |
| `themeClass`  | `string`                                        | CSS class scoping this skin's tokens — set to `"theme-<id>"`.                                   |
| `Layout`      | `ComponentType<{ children: ReactNode }>`        | The app-shell chrome (nav/header) wrapping page content.                                        |
| `nav`         | `NavRoute[]`                                    | Nav entries the layout renders. **Display-only — NOT the segment validator** (see below).       |
| `resolvePage` | `(segments: string[]) => ComponentType \| null` | Maps URL segments (after `/[skin]`) to a page, or `null` → 404. **The sole segment validator.** |
| `Tools`       | `ComponentType`                                 | Registers frontend tools / HITL / gen-UI + agent-context readables. **Renders `null`.**         |
| `catalog`     | `A2uiCatalog`                                   | The skin's a2ui catalog from `createCatalog()`.                                                 |
| `suggestions` | `Suggestion[]`                                  | Static suggestion pills (`{ title, message }`), shown `available:"always"`.                     |
| `designSkill` | `string`                                        | OGUI design brief — injected as agent context to style generated UIs.                           |

`identity` object:

| Field            | Type                                    | Notes                                                                                                                                                  |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `brand`          | `string`                                | Shown in the selector + chat header.                                                                                                                   |
| `tagline`        | `string`                                | Selector tooltip; default chat greeting when `greeting` omitted.                                                                                       |
| `logo`           | `ComponentType<{ className?: string }>` | Logo mark (inline SVG/glyph).                                                                                                                          |
| `favicon?`       | `string`                                | Emoji browser-tab icon (e.g. `"✈️"`). The shell's `FaviconSync` renders it into a `<link rel="icon">` per skin; omit to keep the static `favicon.ico`. |
| `assistantName?` | `string`                                | Chat header title. Defaults to `brand`.                                                                                                                |
| `greeting?`      | `string`                                | Chat welcome message. Defaults to `tagline`.                                                                                                           |

**Optional:**

| Field                   | Type                                                 | Purpose                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Providers?`            | `ComponentType<{ children: ReactNode }>`             | Skin-specific provider stack mounted **below** `CopilotKitProvider` (escape hatch). Omit → shell substitutes a pass-through.                                                                                                                                                                               |
| `CanvasSurface?`        | `ComponentType`                                      | Renders the skin's own a2ui report surface full-region on the shared canvas. Omit if no a2ui report canvas.                                                                                                                                                                                                |
| `sandboxFunctions?`     | `SandboxFunction[]`                                  | Functions exposed inside OGUI sandboxed iframes for this skin.                                                                                                                                                                                                                                             |
| `toolLabels?`           | `Record<string, string>`                             | Human labels for this skin's OWN tool-activity chips, keyed by tool name. Unlisted tools fall back to a prettified raw name.                                                                                                                                                                               |
| `chatHeaderActions?`    | `ChatHeaderAction[]`                                 | Buttons this skin contributes to the shared chat header (drawn before the shell's own controls).                                                                                                                                                                                                           |
| `onSuggestionSelect?`   | `(suggestion: Suggestion, index: number) => boolean` | Intercept a suggestion click. Return `true` if fully handled (shell does nothing further); return `false`/omit for the default "send the message" path.                                                                                                                                                    |
| `RuntimeProviders?`     | `ComponentType<{ children: ReactNode }>`             | Provider stack mounted **above** `CopilotKitProvider` (unlike `Providers`, below). The sanctioned place to establish context your `useRuntimeProperties` must read — it has to sit above the provider so the provider owns `properties` from its first commit. See "Contributing end-user identity" below. |
| `useRuntimeProperties?` | `() => Record<string, unknown> \| undefined`         | Contributes this skin's runtime `properties`; the shell threads the result into `CopilotKitProvider`'s `properties` prop. How a skin scopes its Intelligence runs / durable memory per end-user. Return a stable/memoized object. Omit if the skin contributes no runtime identity.                        |
| `useData?`              | `() => unknown`                                      | Seed-backed data hook; the shell runs it in `SkinProvider`, components read via `useSkinData<T>()`. **Optional** — omit when the skin has no shell-managed data (banking omits it and reads REST + auth directly; then `useSkinData<T>()` returns `undefined`). Airline supplies a real one.               |

Supporting types (also in the contract):

```ts
export interface NavRoute {
  segment: string; // URL segment after the skin, e.g. "" (index), "cards".
  label: string;
  icon?: ComponentType<{ className?: string }>;
}
export interface Suggestion {
  title: string;
  message: string;
}
export interface ChatHeaderAction {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}
export type A2uiCatalog = ReturnType<typeof createCatalog>;
```

> The agent is deliberately absent from this interface — see the boundary
> section above. It lives in `agent.ts` and registers separately.

**`nav` does not decide what resolves.** It is display-only — the list the layout
draws as navigation. `resolvePage` is the single source of truth for which
segments are valid (the contract says so, `skin-contract.ts` around lines 86-92),
and it may accept segments `nav` omits (banking's `resolvePage` accepts a `cards`
index alias its `nav` never lists). So every segment a user can reach — nav
entries, aliases, deep links — must be handled in `resolvePage`; anything it
returns `null` for is a 404, regardless of what `nav` contains.

---

## The layout contract (viewport height + nav insets)

Two things every shipped `Layout` gets right and the naive version gets wrong —
both fixed once in `src/skins/logistics/layout.tsx`, which the template mirrors:

- **The root is `h-screen overflow-hidden`, not `min-h-screen`.** `min-h-screen`
  is a MINIMUM: on a page taller than the viewport the container grows, the whole
  document scrolls, and the pinned nav scrolls away with it — worse, `<main>`'s
  own `overflow-y-auto` goes inert because its parent is unbounded. Make the shell
  exactly one viewport tall (`h-screen overflow-hidden`, plus `h-full` on the
  `<aside>`) so only `<main>` scrolls.
- **Publish the nav insets, and remove them on cleanup.** In a `useEffect`, set
  `--nw-nav-inset-left` / `--nw-nav-inset-right` on `document.documentElement` to
  the width your nav reserves, so the shell's floating skin selector docks in the
  content band instead of on top of your nav. Return a cleanup that REMOVES both —
  a missing cleanup leaks your inset into whatever skin the user switches to next.

## The meta-utility strip

The presenter/dev utilities — Reset, theme toggle, Help — are **skin-authored
chrome, not shell-provided**. A new skin gets none of them for free; you add them
in the layout (the template puts them in an `mt-auto` group at the bottom of the
sidebar). Three controls:

- **Reset** (`RotateCcw`) — render it only when `usePresenterReset()` (from
  `@/shell/presenter-reset-context`) is true; on click, `window.confirm` then
  `POST /api/<id>/v1/dev/reset` then `window.location.assign(`/${skin.id}`)` for a
  pristine slate. Keep the button and the endpoint in agreement: your skin's own
  `dev/reset` route should allow the reset when `presenterResetEnabled() ||
process.env.NODE_ENV !== "production"` (mirror
  `src/app/api/logistics/v1/dev/reset/route.ts`), or a production booth shows a
  button that 403s.
- **ThemeToggle** — `import { ThemeToggle } from "@/components/ui/theme-toggle"`.
  It is a SHARED component under `src/components/ui`, so importing it is fine and
  is NOT a cross-skin import. Remember it is a dead control unless your skin also
  ships a dark palette (`--nw-dark-capable: 1` + a `.dark .theme-<id>` block — see
  the theming rules above).
- **Help** (`HelpCircle`) — calls a `useAskCopilot()` that opens the panel and
  sends a message as the user. **Port** it into your own
  `src/skins/<id>/components/use-ask-copilot.ts` (copy logistics'); do NOT import
  from `src/skins/banking/**` — a skin's only inbound dependency is the contract.

## Registering tools: the deps array + render signatures

Two rules that the `tools.tsx` template bakes in; miss either and the failure is
silent.

- **Every `useComponent` / `useFrontendTool` / `useHumanInTheLoop` registration
  closes with a deps array.** Each takes an **optional deps array as a second
  argument** (`useFrontendTool(tool, deps?: ReadonlyArray<unknown>)`,
  `useHumanInTheLoop(tool, deps?)`, `useComponent(spec, deps?)` — the installed
  types in `@copilotkit/react-core/dist/copilotkit-CBCT7BlL.d.cts` confirm it).
  Omit it and the closure captures whatever the data was at REGISTRATION time —
  for a REST-backed skin, the EMPTY array from before the first fetch — forever.
  This is the nastiest bug in the app because it **compiles, lints, and passes
  every test**: the agent narrates confidently ("the trade-offs are on screen")
  while the component renders its "not found" branch over stale data. Banking
  documents the same trap in a code comment (search "closure captures empty
  arrays" in `src/skins/banking/tools.tsx`); logistics passes deps on every
  registration.
- **A parameterized `useComponent` render receives the schema output DIRECTLY** —
  `render: ({ myParam }) => …`, NOT wrapped in `{ args }`. Per the installed
  types, `InferRenderProps<T> = T extends StandardSchemaV1 ? InferSchemaOutput<T>
: any` and `render: ComponentType<NoInfer<InferRenderProps<TSchema>>>`. By
  contrast `useHumanInTheLoop` and `useFrontendTool` renders DO receive `{ args,
status, respond }`. Airline has no parameterized `useComponent`, so don't learn
  the render shape from it — see the template and logistics' `showShipment`.

---

## Contributing end-user identity (only if your skin has its own auth / memory)

Skip this whole section if your skin has no per-user scoping (like airline —
then omit `RuntimeProviders`, `useRuntimeProperties`, and `identifyUser`, and the
runtime falls back to a generic identity). Read it if your skin has its own auth
and needs to scope Intelligence runs / durable memory per end-user. It is a
three-part client→server mechanism — banking implements all three:

1. **`RuntimeProviders`** (client, in `providers.tsx`) — a provider stack the
   shell mounts **above** `CopilotKitProvider`. Put whatever context supplies
   your identity here (banking hoists its `AuthContextProvider`). It MUST sit
   above the provider because `properties` is a _prop_ of `CopilotKitProvider`,
   so its source has to exist before the provider's first commit — otherwise a
   child would have to race an imperative `setProperties`. (Your other providers
   that _consume_ the CopilotKit context still go in `Providers`, below it.)
2. **`useRuntimeProperties`** (client, in `providers.tsx`) — a hook the shell
   calls inside `RuntimeProviders` and threads straight into
   `CopilotKitProvider`'s `properties` prop. Read your identity context and
   return a **stable/memoized** object (banking returns `{ userRole, userId }`,
   memoized on the member). Do **not** set `a2uiCatalogAvailable` — the shell
   adds that itself when a catalog is present.
3. **`identifyUser`** (server, in a `.ts` module) — registered in
   `agent-registry.ts` as `{ createAgent, identifyUser }`. It receives the
   client-forwarded `properties` and returns `{ id, name }` for thread +
   durable-memory scoping. Because it is reached through the **server-only**
   registry, it MUST be server-safe: **no `"use client"`, no JSX, no `.tsx`
   imports.** Keep it in a plain `.ts` file (mirror
   `src/skins/banking/intelligence/user-id.ts`):

```ts
// src/skins/<id>/intelligence/user-id.ts  — server-safe: no "use client", no JSX
import type { IdentifyRunUser } from "@/shell/agent-registry";

export const <id>IdentifyUser: IdentifyRunUser = (properties) => {
  const userId = properties?.userId ?? "<id>-demo-user";
  return { id: userId, name: properties?.userRole ?? "<Brand> User" };
};
```

The shared API route reads the target `agentId` from the URL and delegates to
that skin's `identifyUser`; agentId-less inspector routes (`/memories/*`,
`/info`) delegate to the **default** skin's resolver. You never edit the route.

---

## Files to create under `src/skins/<id>/`

Mirror the shipped skins' layout:

```
src/skins/<id>/
├── skin.tsx          # assembles + default-exports the Skin object ("use client")
├── identity.ts       # brand, tagline, logo, optional assistantName/greeting/favicon
├── theme.css         # .theme-<id> { … } re-valuing shared tokens
├── layout.tsx        # Layout chrome; side-effect `import "./theme.css"`
├── pages/            # one component per nav segment
├── tools.tsx         # <XTools/> — frontend tools/HITL/gen-UI + readables; renders null
├── catalog/          # createCatalog(...) → the a2ui catalog (index.tsx)
├── suggestions.ts    # Suggestion[]
├── design-skill.ts   # the OGUI design-brief string
├── data/             # OPTIONAL: seed data + use-data hook (useXData) → useData
└── agent.ts          # SERVER-ONLY: export const <id>Agent = () => new BuiltInAgent(...)
```

Optional slots you may omit — airline omits all of these EXCEPT `toolLabels` and
`useData`: `providers.tsx` (→ `Providers` and/or `RuntimeProviders` +
`useRuntimeProperties`), `intelligence/user-id.ts` (→ server `identifyUser`),
`canvas-surface.tsx` (→ `CanvasSurface`), `sandboxFunctions`,
`chatHeaderActions`, `onSuggestionSelect`. (`useData` / `data/` is where the two
shipped skins split: airline SETS `useData: useAirlineData`; banking omits it and
reads REST + auth directly, so its `useSkinData<T>()` returns `undefined`.)
Airline DOES set `toolLabels` (a 9-entry map) so its tool-activity chips read as
human phrases ("Pulling up your flight") instead of raw tool names (`showFlight`)
— treat `toolLabels` as expected for any skin with named frontend tools, not
optional in practice. `RuntimeProviders`/`useRuntimeProperties`/`identifyUser`
are only for a skin with its own end-user identity (see the identity section
above); banking uses all three, airline none.

Templates for each file are in **[templates.md](./templates.md)** — copy them and
fill in your domain. They are written against this app's real contract.

---

## Authoring order (slot by slot)

Build in dependency order so each slot compiles before the next depends on it:

1. **identity** (`identity.ts`) — brand, tagline, logo.
2. **theme** (`theme.css`) — `.theme-<id>` token values.
3. **data** (`data/`, OPTIONAL) — seed + `useXData()` hook (feeds pages, tools, and the agent's context). Skip if the skin has no shell-managed data (then omit `useData`).
4. **layout** (`layout.tsx`) — chrome; side-effect-import `./theme.css` here.
5. **pages** (`pages/`) — one component per nav segment.
6. **tools** (`tools.tsx`) — frontend tools / HITL / gen-UI + `useAgentContext` readables.
7. **catalog** (`catalog/`) — a2ui catalog via `createCatalog`.
8. **agent** (`agent.ts`) — server-only `BuiltInAgent` factory.
9. **suggestions** (`suggestions.ts`) + **design-skill** (`design-skill.ts`).
10. **register** — `skin.tsx` assembles the object; then wire both registries.

Run `pnpm build` after wiring things up — `next build` type-checks the whole app
(there is no separate `typecheck` script). `pnpm lint` catches the rest.

---

## Registration (the only shared-file touch)

Two appends, both keyed by the identical `id`.

**1. Client skin** — `src/shell/registry.ts`:

```ts
import type { Skin } from "./skin-contract";
import banking from "@/skins/banking/skin";
import airline from "@/skins/airline/skin";
import support from "@/skins/support/skin"; // ← add

export { defaultSkinId } from "./skins-config";

export const SkinRegistry: Record<string, Skin> = {
  [banking.id]: banking,
  [airline.id]: airline,
  [support.id]: support, // ← add
};
```

**2. Server agent** — `src/shell/agent-registry.ts`. Each entry is
`{ createAgent, identifyUser? }`. Add `identifyUser` ONLY if your skin scopes
Intelligence per end-user (see the identity section above); omit it otherwise
(like airline):

```ts
import { bankingAgent } from "@/skins/banking/agent";
import { airlineAgent } from "@/skins/airline/agent";
import { bankingIdentifyUser } from "@/skins/banking/intelligence/user-id";
import { supportAgent } from "@/skins/support/agent"; // ← add
// import { supportIdentifyUser } from "@/skins/support/intelligence/user-id"; // ← only if per-user

export const agentRegistry: Record<string, AgentRegistration> = {
  banking: { createAgent: bankingAgent, identifyUser: bankingIdentifyUser },
  airline: { createAgent: airlineAgent }, // no per-user identity
  support: { createAgent: supportAgent }, // ← add (same id)
  // support: { createAgent: supportAgent, identifyUser: supportIdentifyUser },
};
```

(`AgentRegistration` and the `IdentifyRunUser` type are declared in
`agent-registry.ts` itself — import the type from there for your resolver.)

**3. (Optional) default skin** — set `defaultSkinId` in
`src/shell/skins-config.ts` if the `/` redirect should land on your new skin:

```ts
export const defaultSkinId = "support";
```

Do NOT touch anything else in the shell.

---

## Verification

1. `pnpm build` — green (type-checks the whole app; there is no `typecheck`
   script). `pnpm lint` — green.
2. `pnpm dev` (needs `OPENAI_API_KEY`; copy `.env` from `.env.example`).
3. The skin appears in the **floating selector** (bottom-left).
4. Navigating to `/<id>` renders your `Layout` with the correct theme (your
   `.theme-<id>` token values visibly applied — accent color, canvas, etc.).
5. Sending a chat message gets a reply from **your** agent (confirms
   `id === agentId` and that the agent registered correctly).
6. Your suggestion pills appear, and if you registered frontend tools / HITL /
   gen-UI, the agent can drive them.

If the skin 404s: check `resolvePage` returns a component for `[]` (the index
segment). If the theme doesn't apply: confirm `themeClass === "theme-<id>"` and
that `layout.tsx` side-effect-imports `./theme.css`. If chat errors with an
unknown agent: confirm the agent is in `agent-registry.ts` under the same `id`.
