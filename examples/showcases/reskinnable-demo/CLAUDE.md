# Reskinnable Demo — architecture

One Next.js app whose **entire** experience — brand, theme, layout, pages,
tools, and agent — is reskinnable at runtime. A skin-agnostic **shell** hosts
one **skin** per route segment `/[skin]/...`. It ships two skins, `banking` and
`airline`, switchable from a floating selector, plus a repo-local **reskin
skill** (`.claude/skills/reskin/`) for authoring new ones.

The point of the app is the `Skin` contract: a single interface that swaps a
whole product without the shell knowing anything domain-specific. The two
shipped skins deliberately sit on **different data substrates** (banking is
REST-backed, airline is in-memory) to prove the contract is substrate-agnostic.

## Shell vs skins

- **Shell** (`src/shell/`) — skin-agnostic host. Owns the `Skin` contract, the
  client + server registries, routing/provider composition, the floating skin
  selector, the shared chat panel, and the shared canvas region. It never
  imports a skin's internals; it only consumes the contract.
- **Skins** (`src/skins/<id>/`) — each is a domain plugin living entirely in its
  own folder. Its ONLY inbound dependency on shared code is the `Skin` contract
  in `src/shell/skin-contract.ts`. That is what lets skins be built in isolation.

## The `Skin` contract

Defined in `src/shell/skin-contract.ts` (the interface is frozen after Phase 0).
Every field below is exactly as declared there.

Required:

| Field         | Type                                            | Purpose                                                                             |
| ------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `id`          | `string`                                        | Stable id. MUST equal the route segment AND the agent id.                           |
| `identity`    | object (below)                                  | Brand identity the shell renders.                                                   |
| `themeClass`  | `string`                                        | CSS class scoping this skin's design-token values — set to `"theme-<id>"`.          |
| `Layout`      | `ComponentType<{ children: ReactNode }>`        | The app-shell chrome (nav/header) wrapping page content.                            |
| `nav`         | `NavRoute[]`                                    | Nav entries; also the source of truth for which segments are valid.                 |
| `resolvePage` | `(segments: string[]) => ComponentType \| null` | Maps URL segments after `/[skin]` to a page component, or `null` → 404.             |
| `Tools`       | `ComponentType`                                 | Registers frontend tools / HITL / gen-UI + agent-context readables. Renders `null`. |
| `catalog`     | `A2uiCatalog`                                   | The skin's a2ui catalog from `createCatalog()`.                                     |
| `suggestions` | `Suggestion[]`                                  | Static suggestion pills, registered `available:"always"`.                           |
| `designSkill` | `string`                                        | OGUI design brief, injected as agent context to style generated UIs.                |

`identity` (required object):

| Field            | Type                                    | Notes                                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand`          | `string`                                | Shown in the selector and chat header.                                                                                                                                                                                                        |
| `tagline`        | `string`                                | Selector tooltip; the default chat greeting when `greeting` is omitted.                                                                                                                                                                       |
| `logo`           | `ComponentType<{ className?: string }>` | Logo mark (inline SVG/glyph).                                                                                                                                                                                                                 |
| `favicon?`       | `string`                                | Emoji browser-tab icon (e.g. `"✈️"`). The shell's `FaviconSync` (in `src/app/[skin]/layout.tsx`) renders it into a `<link rel="icon">` SVG data URI per skin, and restores the static `favicon.ico` on unmount. Omit to keep the static icon. |
| `assistantName?` | `string`                                | Chat header title. Defaults to `brand`.                                                                                                                                                                                                       |
| `greeting?`      | `string`                                | Chat welcome message. Defaults to `tagline`.                                                                                                                                                                                                  |

Optional:

| Field                   | Type                                                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Providers?`            | `ComponentType<{ children: ReactNode }>`             | Escape hatch: a skin-specific provider stack mounted **below** `CopilotKitProvider` (banking uses it for its recording context). Omitted → the shell substitutes a pass-through.                                                                                                                                                                                                                                                                                 |
| `CanvasSurface?`        | `ComponentType`                                      | Renders this skin's own a2ui report surface full-region on the shared canvas. Omit if the skin has no a2ui report canvas (airline omits it).                                                                                                                                                                                                                                                                                                                     |
| `sandboxFunctions?`     | `SandboxFunction[]`                                  | Functions exposed inside OGUI sandboxed iframes for this skin (e.g. banking's spend-data getters).                                                                                                                                                                                                                                                                                                                                                               |
| `toolLabels?`           | `Record<string, string>`                             | Human labels for this skin's own tool-activity chips, keyed by tool name. Unlisted tools fall back to a prettified raw name.                                                                                                                                                                                                                                                                                                                                     |
| `chatHeaderActions?`    | `ChatHeaderAction[]`                                 | Buttons this skin contributes to the shared chat header, drawn before the shell's own controls.                                                                                                                                                                                                                                                                                                                                                                  |
| `onSuggestionSelect?`   | `(suggestion: Suggestion, index: number) => boolean` | Intercepts a suggestion click. Return `true` if the skin fully handled it (the shell does nothing further); return `false`/omit for the default "send the message" path.                                                                                                                                                                                                                                                                                         |
| `RuntimeProviders?`     | `ComponentType<{ children: ReactNode }>`             | Provider stack mounted **above** `CopilotKitProvider` (unlike `Providers`, which mounts below). The sanctioned place to establish any context `useRuntimeProperties` must read — the identity source must sit above the provider so the provider owns the property bag from its first commit (no child racing `setProperties`). Banking hoists its `AuthContextProvider` here; airline omits it.                                                                 |
| `useRuntimeProperties?` | `() => Record<string, unknown> \| undefined`         | Contributes this skin's runtime `properties`. The shell calls it inside `RuntimeProviders` (above `CopilotKitProvider`) and threads the result straight into `CopilotKitProvider`'s `properties` prop — this is how a skin scopes its Intelligence runs / durable memory per end-user without the shell reaching into skin internals. Return a stable/memoized object; banking returns `{ userRole, userId }`. Omit if the skin contributes no runtime identity. |
| `useData?`              | `() => unknown`                                      | Seed-backed data hook; the shell runs it in `SkinProvider`, components read it via `useSkinData<T>()`. Omit when a skin has no shell-managed data — banking omits it (it reads REST via `useCreditCards` and the member via `useAuthContext` directly), so `useSkinData<T>()` returns `undefined`. Airline supplies a real one.                                                                                                                                  |

Supporting types (also in the contract file):

- `NavRoute` — `{ segment: string; label: string; icon?: ComponentType<{ className?: string }> }`.
- `Suggestion` — `{ title: string; message: string }`.
- `ChatHeaderAction` — `{ icon: ComponentType<{ className?: string }>; label: string; onClick: () => void }`.
- `A2uiCatalog` — `ReturnType<typeof createCatalog>` from `@copilotkit/a2ui-renderer`.

## The client/server boundary (important)

**A skin's agent is server-only and is NOT part of the client `Skin` contract.**
Agents pull in `@copilotkit/runtime`, which must never be bundled into the
browser. So:

- Each skin co-locates its agent in a **server-safe** `src/skins/<id>/agent.ts`
  — no `"use client"`, no JSX, no React — exporting a factory
  `export const <id>Agent = () => new BuiltInAgent({ ... })`.
- The client skin module (`skin.tsx`) **never imports `agent.ts`.** The only
  link between a skin and its agent is the shared `id` (`id === agentId`).
- Two registries, one id:
  - `src/shell/registry.ts` — the **client** `SkinRegistry` (imports full skin
    modules, which contain client components).
  - `src/shell/agent-registry.ts` — the **server** `agentRegistry` map (imports
    only server-safe modules). Kept separate so the API route never pulls
    client-only code server-side.
- `src/shell/skins-config.ts` holds `defaultSkinId` as pure config (no skin
  imports), so the server-component `/` redirect can read it without dragging
  client skin modules into an RSC.

### Per-skin server identity (`agentRegistry`)

`agentRegistry` is `Record<string, AgentRegistration>`, where each
`AgentRegistration` is `{ createAgent: () => BuiltInAgent; identifyUser?:
IdentifyRunUser }` — **not** a bare factory. A skin contributes an OPTIONAL,
**server-safe** `identifyUser` alongside its agent factory to resolve a stable
end-user identity for Intelligence thread + durable-memory scoping:

```ts
export type IdentifyRunUser = (
  properties: { userRole?: string; userId?: string } | undefined,
) => { id: string; name: string };
```

- **Banking** contributes `bankingIdentifyUser`
  (`src/skins/banking/intelligence/user-id.ts`), which maps the client-forwarded
  `properties` ({ userRole, userId }) onto its per-member/role memory scope.
  **Airline** omits it (no auth, no memory).
- `identifyUser` is reached through the **server-only** registry, so it MUST be
  server-safe: **no `"use client"`, no JSX, no `.tsx` imports.** Keep it in a
  plain `.ts` module.
- `src/app/api/copilotkit/[[...slug]]/route.ts` extracts the target `agentId`
  from the request URL and delegates to that skin's `identifyUser`. Requests
  with **no** agentId (the inspector's `/memories/*` and `/info`) delegate to the
  **default skin's** resolver (`agentRegistry[defaultSkinId]?.identifyUser`). If
  neither yields one, it falls back to a generic identity that honours
  `INTELLIGENCE_USER_ID` / `INTELLIGENCE_USER_NAME`.
- The client half of this mechanism is the skin's `RuntimeProviders` +
  `useRuntimeProperties` (above): the skin's `properties` flow through
  `CopilotKitProvider` and arrive at the server as the run body's
  `forwardedProps`, which `identifyUser` reads.

## Routing and provider composition

- `src/app/page.tsx` — server component; redirects `/` to `/${defaultSkinId}`.
- `src/app/[skin]/layout.tsx` — resolves the skin from the URL via `getSkin`; a
  404 if unknown. It mounts the per-skin runtime subtree **keyed by `skin.id`**,
  so switching skins fully remounts the CopilotKit provider and starts a fresh
  thread — each skin runs in its own clean world. Composition, outside-in:
  `<div className={skin.themeClass}>` → `FaviconSync` (renders
  `identity.favicon`) → the skin's optional `RuntimeProviders` (mounted **above**
  the provider, so `useRuntimeProperties` can read its context) →
  `CopilotKitProvider` (runtimeUrl `/api/copilotkit`, `useSingleEndpoint={false}`,
  `properties={skin.useRuntimeProperties?.()}`, the skin's `catalog`,
  `sandboxFunctions`, `designSkill`) → `CopilotChatConfigurationProvider
agentId={skin.id}` → `SkinProvider` (runs `skin.useData?.()`) → chat-inbox +
  canvas providers → the skin's optional `Providers` (mounted **below** the
  provider) → `SkinSuggestions` + `Tools` + `Layout` (wrapping `CanvasRegion`) +
  the shared `ChatPanel` and `FloatingSelector`.
- `src/app/[skin]/[[...rest]]/page.tsx` — renders `skin.resolvePage(rest)`, or a
  404 when it returns `null`.
- `src/app/api/copilotkit/[[...slug]]/route.ts` — the Hono runtime handler. It
  builds one `BuiltInAgent` per registered skin from `agentRegistry` (calling
  each registration's `createAgent`), keyed by id, so `agentId={skin.id}`
  resolves the right agent. Its `identifyUser` callback delegates per skin (see
  the boundary section above). Env-gated: pure SSE `CopilotRuntime` +
  `InMemoryAgentRunner` by default (OSS path); a `CopilotKitIntelligence` runtime
  when `INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, and
  `INTELLIGENCE_API_KEY` are all set.

## The theming contract

The **shell owns the design-token vocabulary**; a **skin owns the values**.

- `src/app/globals.css` declares the shared token _names_ (`--brand`,
  `--surface`, `--ink`, `--hairline`, `--canvas`, `--positive`, `--negative`,
  `--radius`, …) and exposes them to Tailwind v4 via `@theme inline`, so shared
  chrome styles itself with semantic utilities (`bg-surface`, `text-ink`,
  `border-hairline`, `bg-brand`, `shadow-soft`, …).
- Each skin ships a `src/skins/<id>/theme.css` containing a single
  `.theme-<id> { … }` block that **re-values those existing tokens** (never
  invents new names). It is imported as a side-effect from the skin's
  `layout.tsx`, and `skin.themeClass` must equal `"theme-<id>"` so the shell
  applies the block on the theme root.

Because chrome and skin components both consume the semantic utilities, a reskin
is a pure value swap — no component edits. (Describe the contract, not specific
values: the token _names_ live in the shell; the hex/HSL _values_ live per-skin.)

## The shared canvas and OGUI

The shell owns the canvas region and surface-kind detection
(`src/shell/canvas/`). When an agent run produces a surface activity, the canvas
takes over the page-content region with a "← Back" affordance:

- **OGUI** — a `generateSandboxedUi` call becomes an `open-generative-ui`
  activity. The shell renders it **full-region on the shared canvas** via the
  workspace `OpenGenerativeUIActivityRenderer` (this build ships that renderer).
  A skin does NOT supply an OGUI renderer; it only contributes
  `sandboxFunctions` + `designSkill`. In the chat, a small "→ rendered on the
  canvas" handoff pill stands in for the surface.
- **a2ui report** — a report tool result becomes an `a2ui-surface` activity;
  the canvas defers to the active skin's own `CanvasSurface`. A skin without one
  (airline) renders nothing for that kind.

Gen-UI components registered via `useComponent` (airline's flight card, banking's
charts and queues) render in the chat transcript, not on the canvas — that is a
separate path from the full-region canvas surfaces above.

## The two skins (why they differ)

- **`banking`** ("Northwind Finance") — **REST-backed**. Its pages, tools, and
  report canvas read a live ledger over `/api/banking/v1/*` (cards, transactions,
  users, policies, exceptions, reports, and a gated `dev/reset`). It uses the
  optional `Providers`, `CanvasSurface`, `sandboxFunctions`, `chatHeaderActions`
  (a paperclip that stages a bundled Q2 invoice PDF), `onSuggestionSelect` (the
  Q2 pill drives the real composer so the invoice rides as an attachment), and —
  to scope durable memory per member — `RuntimeProviders` (hoists its
  `AuthContextProvider` above the provider) + `useRuntimeProperties` (returns
  `{ userRole, userId }`) on the client plus a server-safe `identifyUser` in the
  agent registry. It **omits** `useData` — its components read the REST ledger
  via `useCreditCards` and the current member via `useAuthContext` directly, so
  nothing flows through `useSkinData`.
- **`airline`** ("Aeronova") — **in-memory**. Its `useData` (`useAirlineData`) is
  a seed-backed React-state store with no backend; mutations (`selectSeat`,
  `issueBoardingPass`, `chooseRebooking`) update local state. It omits
  `Providers`, `CanvasSurface`, `sandboxFunctions`, `chatHeaderActions`,
  `onSuggestionSelect`, `RuntimeProviders`, `useRuntimeProperties`, and a server
  `identifyUser` — the minimal end of the contract (only `toolLabels` beyond the
  required fields).

Two substrates behind one contract is the whole demonstration.

## How to add a skin

Use the repo-local skill in `.claude/skills/reskin/` — it walks the full
authoring flow. In short:

1. Scaffold `src/skins/<id>/` and implement each `Skin` contract field.
2. Write `src/skins/<id>/theme.css` (a `.theme-<id>` block re-valuing shared
   tokens) and side-effect-import it from the skin's `layout.tsx`.
3. Add a server-safe `src/skins/<id>/agent.ts` (no `"use client"`, no JSX).
4. Register in **both** `src/shell/registry.ts` (client skin) and
   `src/shell/agent-registry.ts` (as `{ createAgent, identifyUser? }`), keyed by
   the identical `id`.
5. If the skin scopes Intelligence per end-user, add its client
   `RuntimeProviders` + `useRuntimeProperties` and a server-safe `identifyUser`.
6. Optionally set `defaultSkinId` in `src/shell/skins-config.ts`.

## Commands

Real scripts from `package.json` (there is no `typecheck` script — `pnpm build`
type-checks as part of `next build`):

- `pnpm dev` — run the app (needs `OPENAI_API_KEY`; copy `.env` from
  `.env.example`). Visit `/`, which redirects to the default skin.
- `pnpm build` — production build (also the type-check gate).
- `pnpm start` — serve the production build.
- `pnpm lint` — ESLint.
- `pnpm test:unit` — Vitest unit tests.
- `pnpm test:e2e` / `pnpm test:e2e:ogui` / `pnpm test:self-learning` — Playwright
  suites.
- `pnpm mint-dev-license` — mint a dev license (Intelligence mode).

Run tasks through Nx per the repo convention where applicable.

## Reference

- `src/shell/skin-contract.ts` — the contract (source of truth).
- `src/skins/banking/skin.tsx`, `src/skins/airline/skin.tsx` — two implementations.
- `docs/DESIGN.md` — the banking skin's visual design system ("Aurora").
- `docs/teach-mode/` — the banking skin's teachable over-limit-approval flow.
