# Reskinnable Demo — architecture

One Next.js app whose **entire** experience — brand, theme, layout, pages,
tools, and agent — is reskinnable at runtime. A skin-agnostic **shell** hosts
one **skin** per route segment `/[skin]/...`. It ships six skins — `banking`,
`airline`, `logistics`, `keel`, `people` and `commerce` — switchable from a
dropdown at the top of the assistant column, plus a repo-local **reskin skill**
(`.claude/skills/reskin/`) for authoring new ones.

The point of the app is the `Skin` contract: a single interface that swaps a
whole product without the shell knowing anything domain-specific. The skins
deliberately sit on **two different data substrates** — banking, logistics,
people and commerce are REST-backed, airline and keel are in-memory — to prove
the contract is substrate-agnostic.

**Each skin is also a live sales demo.** It exists to prove CopilotKit and
Intelligence top to bottom to an enterprise buyer, through a fixed set of demo
**beats**: lead with generative UI, show that threads store AG-UI streams rather
than text, manipulate the app four ways (drive it, read the screen, navigate via
real levers, ingest a document into a durable artifact), recall long-term memory,
replay a stored procedure, and learn a new one on stage. `banking` is the original
reference implementation; `people` and `commerce` are the later skins built to hit
every beat. The
beats, and what each one must prove, are specified in
[`.claude/skills/reskin/demo-beats.md`](.claude/skills/reskin/demo-beats.md) —
read it before adding or changing a skin's tools, prompt or suggestion pills,
because a skin that wires the contract perfectly and hits no beats is a failed
skin.

## ⚠️ Changing existing code? Review whether the reskin skill went stale

**Every change to existing code in this app ends with one explicit question,
answered out loud before the work is called done:**

> Does this change make anything in `.claude/skills/reskin/` wrong, incomplete,
> or misleading for the next person authoring a skin?

Answer it in the PR description or the commit body — "checked, no skill impact" is
a fine answer. An UNANSWERED question is the failure; a considered "no" is not.

**Why this is a standing rule rather than a nice-to-have.** The skill is the only
instruction a new skin's author reads, and it goes stale SILENTLY — nothing
type-checks it, no test imports it, and a skin built from a stale template still
compiles, lints and renders. Every one of these actually happened while shipping
the LOCK_SKIN root-serving change:

- `templates.md` handed every new skin the exact two patterns that change had just
  removed (a hardcoded `/${skin.id}/…` href and a fixed `pathname.split("/").slice(2)`).
  Both fail **silently** under a lock — the page still renders, the URL is just wrong.
- SKILL.md's verification steps pointed at `pnpm test:unit` and a drift test that the
  same PR **deleted**. Caught by a reviewer, not by any tooling.
- The authoring half of the skill was updated and the VERIFICATION half was not; the
  gap survived until someone asked about it specifically.

**Changes that implicate the skill** — treat these as automatic triggers, not a
judgement call:

| You changed                                                                  | Check                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| The `Skin` contract (`src/shell/skin-contract.ts`)                           | SKILL.md's field-by-field table, templates.md's scaffolds            |
| Anything a skin must call or must not call (link builders, hooks, providers) | SKILL.md's contract sections, every template that shows the old form |
| A lint rule, test or gate a skin has to pass                                 | SKILL.md § Verification — does it name the right command?            |
| Registration, routing, or the client/server boundary                         | SKILL.md § Registration + the boundary section                       |
| A demo beat's mechanism, or what a beat must prove                           | demo-beats.md                                                        |
| A skin's brand, id or identity                                               | the skin lists in SKILL.md, CLAUDE.md and README.md                  |
| Deleting or renaming a file the skill references                             | grep the skill for the old path                                      |

**The cheap check, ~2 minutes:**

```bash
# 1. Does the skill still reference anything you deleted or renamed?
grep -rn "<old-symbol-or-path>" .claude/skills/reskin/

# 2. Do the templates still teach the pattern you just replaced?
grep -rn "<the-old-pattern>" .claude/skills/reskin/templates.md

# 3. Does SKILL.md § Verification still name commands that exist and gates that run?
```

If the change is load-bearing for skin authors, update the skill **in the same PR**.
A skill that documents last week's contract is worse than no skill: it is trusted.

## Shell vs skins

- **Shell** (`src/shell/`) — skin-agnostic host. Owns the `Skin` contract, the
  client + server registries, routing/provider composition, the inset frame
  (`src/shell/layout/`), the skin selector, the shared chat panel, and the shared
  canvas region. It never imports a skin's internals; it only consumes the
  contract.
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

| Field                   | Type                                                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Providers?`            | `ComponentType<{ children: ReactNode }>`             | Escape hatch: a skin-specific provider stack mounted **below** `CopilotKitProvider`, for anything that must consume CopilotKit context. Set by the four REST-backed skins — banking, people and commerce for their teach-mode recording context (plus their OGUI sandbox data sync), logistics for the sandbox sync alone; omitted by airline and keel → the shell substitutes a pass-through.                                                                                                                                                                                                                                                                                               |
| `CanvasSurface?`        | `ComponentType`                                      | Renders this skin's own a2ui report surface full-region on the shared canvas. Omit if the skin has no a2ui report canvas (airline omits it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `sandboxFunctions?`     | `SandboxFunction[]`                                  | Functions exposed inside OGUI sandboxed iframes for this skin (e.g. banking's spend-data getters).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `toolLabels?`           | `Record<string, string>`                             | Human labels for this skin's own tool-activity chips, keyed by tool name. Unlisted tools fall back to a prettified raw name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `chatHeaderActions?`    | `ChatHeaderAction[]`                                 | Buttons this skin contributes to the shared chat header, drawn before the shell's own controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `onSuggestionSelect?`   | `(suggestion: Suggestion, index: number) => boolean` | Intercepts a suggestion click. Return `true` if the skin fully handled it (the shell does nothing further); return `false`/omit for the default "send the message" path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RuntimeProviders?`     | `ComponentType<{ children: ReactNode }>`             | Provider stack mounted **above** `CopilotKitProvider` (unlike `Providers`, which mounts below). The sanctioned place to establish any context `useRuntimeProperties` must read — the identity source must sit above the provider so the provider owns the property bag from its first commit (no child racing `setProperties`). Banking hoists its `AuthContextProvider` here; airline omits it.                                                                                                                                                                                                                                                                                             |
| `useRuntimeProperties?` | `() => Record<string, unknown> \| undefined`         | Contributes this skin's runtime `properties`. The shell calls it inside `RuntimeProviders` (above `CopilotKitProvider`) and threads the result straight into `CopilotKitProvider`'s `properties` prop — this is how a skin scopes its Intelligence runs / durable memory per end-user without the shell reaching into skin internals. Return a stable/memoized object; banking returns `{ userRole, userId }`. Omit if the skin contributes no runtime identity.                                                                                                                                                                                                                             |
| `useData?`              | `() => unknown`                                      | Seed-backed data hook; the shell runs it in `SkinProvider`, components read it via `useSkinData<T>()`. **This is the standard mechanism for the two in-memory skins and is deliberately unused by the four REST-backed ones**, so it splits exactly along the substrate line: `airline` (`useAirlineData`) and `keel` (`useKeelData`) each supply a real one, while banking, logistics, people and commerce all omit it and read their REST ledger through their own context/hooks instead (banking via `useCreditCards` + `useAuthContext`; logistics `useLogistics()`; people `usePeopleLedger()`; commerce `useCommerceLedger()`) — in those four `useSkinData<T>()` returns `undefined`. |

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
- `src/shell/skins-config.ts` holds `defaultSkinId`, `skinIds` and
  `skinIdentities` as pure config (no skin imports), so the server-component `/`
  redirect, the root layout's `generateMetadata`, `src/proxy.ts` and the
  `LOCK_SKIN` validator can read them without dragging client skin modules into
  an RSC (or, for the proxy, into the request hook).
  `skinIds` duplicates the registry's keys on purpose, and `skinIdentities`
  duplicates every skin's `identity.brand` + `identity.tagline` — that map is
  what `generateMetadata` in `src/app/layout.tsx` reads to give a `LOCK_SKIN`
  deploy the locked brand as its `<title>` and the locked tagline as its
  `<meta name="description">` (unlocked, both fall back to the generic
  demo pair). `skins-config.test.ts` is the drift guard for both copies;
  `skinIdentities` is additionally typed
  `Record<(typeof skinIds)[number], …>`, so a registered skin with no entry is a
  `pnpm build` type error rather than a wrong tab title.

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
  **People** contributes `peopleIdentifyUser` and, like banking, actually uses it
  for durable memory — its `intelligence/seed-memories.ts` seeds the mapped
  operator's bucket (Maya's) AND the default one, because runs frequently resolve
  to the default: the client's `properties` often do not reach `identifyUser`, so
  Maya and Clara both land in `rowan-demo-user` and switching operator re-scopes
  nothing (read `src/skins/people/intelligence/user-id.ts` before writing
  anything about per-operator scoping there). **Commerce** contributes
  `commerceIdentifyUser` and likewise uses it for durable memory — its
  `intelligence/seed-memories.ts` seeds the mapped operator's bucket AND the
  default one, because runs frequently resolve to the default (read
  `src/skins/commerce/intelligence/user-id.ts` before writing anything about
  per-operator scoping there). **Logistics** and **keel** contribute one too
  (`logisticsIdentifyUser`, `keelIdentifyUser`) for thread scoping — though
  neither yet uses it for durable memory. That is five of the six skins;
  **airline** is the only one that omits it (no auth, no memory).
- Every skin that claims the memory beats additionally ships
  `intelligence/seed-memories.ts` and `intelligence/forget-memories.ts`, which its
  `dev/reset` route uses to wipe learned memories and re-seed the ones the demo
  must start out already knowing. Today that is the three demo-complete skins —
  **banking**, **commerce** and **people**. That pair is what makes the
  long-term-memory, stored-procedure-replay and teach-a-procedure beats work; it
  is not emergent behaviour. The gated `dev/reset` route is the wider set: four
  skins have one, those three plus **logistics** — which ships neither memory
  file, so its reset restores its data store only and cannot restore the memory
  beats.
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

- `src/proxy.ts` — the LOCK_SKIN URL space. Unlocked it is inert. Under a lock it
  REWRITES the prefix-free space onto the route tree (`/` → `/banking`,
  `/cards` → `/banking/cards`) so the locked skin is **served at `/`** and the
  tenant segment never appears in the address bar. Its matcher excludes `api`,
  so the runtime's SSE stream never passes through it. It is `proxy.ts` (Next
  16's rename of `middleware.ts`) rather than a `next.config` rewrite because
  `rewrites()` is baked into routes-manifest.json at BUILD time, which would
  freeze the lock into the artifact; proxy files always run on the Node server,
  so LOCK_SKIN stays a per-request read and ONE BUILD SERVES BOTH shapes.
- **Links must go through `useSkinHref`** (`src/shell/skin-path.ts`) — the client
  half of that contract. A hardcoded `/${skin.id}/...` href would put the prefix
  straight back in the address bar on the first nav click of a locked deploy.
  `pnpm lint` enforces this — the `no-restricted-syntax` skin-prefix selectors in
  `eslint.config.mjs` fail and name your file if an in-skin link embeds a skin
  prefix, or, when the value is a navigation target (`router.push`/`replace`,
  `location.assign`/`href`, JSX `href`), concatenates a path onto an interpolation
  and yields a leading `//`. The `//` guard is nav-scoped on purpose so it never
  false-positives on ordinary date/ratio templates (`` `${m}/${d}` ``); the cost is
  that a URL built into a variable before navigating is not caught by that guard.
  Those selectors interpolate `LINTED_SKIN_IDS` from the same file — a hand-copy of
  `skinIds` (an ESLint flat config is loaded by Node and cannot import a `.ts`
  module), so **a new skin must be appended there or lint is blind to it**.
  `skins-config.test.ts` guards that copy by linting a synthetic prefixed link for
  every registered skin through the real selectors; it exists because the list did
  rot, naming four skins for two releases after `people` and `commerce` shipped.
  `useSkinSegments` is its companion for nav active-state; it strips a LEADING
  skin id rather than slicing a fixed offset, so it is correct whether or not the
  pathname carries the prefix. Keel wraps both in `src/skins/keel/href.ts`.
- `src/app/page.tsx` — server component; the UNLOCKED front door. Redirects `/`
  to `/${defaultSkinId}`. Under a lock this page never runs: the proxy REWRITES
  `/` to `/<locked>` in place (no redirect) before routing reaches it, so a
  locked server answers `GET /` with 200 and the locked skin's route tree. Its
  `lockedSkinId()` read is therefore dead on any supported deploy (null when the
  page actually runs, and bypassed by the proxy under a lock); it is kept only as
  a proxy-INDEPENDENT backup — were `/` to reach this page under a lock with the
  proxy absent, it targets the locked skin's real route `/<locked>` (which
  renders) rather than `defaultSkinId` (which 404s when it differs from the
  lock). It is not the double-prefix trap: `/<locked>` is re-rewritten to
  `/<locked>/<locked>` only when the proxy is present, and then this page never
  runs.
- `src/app/[skin]/layout.tsx` — resolves the skin from the URL via `getSkin`; a
  404 if unknown, and also a 404 if `LOCK_SKIN` pins the deploy to a different
  skin (`isSkinLockedOut`). `notFound()` throws before `SkinRuntime` renders, so
  this client path never mounts a provider, a thread, or an agent registration
  for a disowned skin. (The server-side agent registry is unaffected —
  `LOCK_SKIN` gates the UI, not the registry.) Under the proxy `[skin]` is always
  the locked skin, so `isSkinLockedOut` no longer fires on path access there; it
  is kept as defence in depth for any route that reaches the layout directly.
  For a reachable skin, the layout mounts the per-skin runtime subtree **keyed
  by `skin.id`**, so switching skins fully remounts the CopilotKit provider and
  starts a fresh thread — each skin runs in its own clean world. Composition,
  outside-in:
  `<div className={skin.themeClass}>` → `FaviconSync` (renders
  `identity.favicon`) → the skin's optional `RuntimeProviders` (mounted **above**
  the provider, so `useRuntimeProperties` can read its context) →
  `CopilotKitProvider` (runtimeUrl `/api/copilotkit`, `useSingleEndpoint={false}`,
  `properties={skin.useRuntimeProperties?.()}`, the skin's `catalog`,
  `sandboxFunctions`, `designSkill`, and `showDevConsole={true}`) →
  `CopilotChatConfigurationProvider
agentId={skin.id}` → `SkinProvider` (runs `skin.useData?.()`) → chat-inbox +
  canvas providers → the skin's optional `Providers` (mounted **below** the
  provider) → `SkinSuggestions` + `Tools` + `LayoutPreferencesProvider` →
  `ShellFrame`, which receives the skin's `Layout` (wrapping `CanvasRegion`) as its
  `app` slot and the shared `ChatPanel` as its `chat` slot.
- **The inspector is shell-mounted for every skin** via that
  `showDevConsole={true}`, which surfaces `CopilotKitInspector`. It replaced the
  old app-specific "glass engine"; a skin contributes nothing to it. Not part of
  the standard demo flow, but the thing to open when a technical audience wants to
  see the actual AG-UI event stream, or when debugging one.
- `src/app/[skin]/[[...rest]]/page.tsx` — renders `skin.resolvePage(rest)`, or a
  404 when it returns `null`. `resolvePage` receives **all** remaining segments, so
  a skin can resolve parameterized routes — `keel` is the worked example
  (`knowledge/<docId>`, `runs/<runId>`).
- `src/app/api/copilotkit/[[...slug]]/route.ts` — the Hono runtime handler. It
  builds one `BuiltInAgent` per registered skin from `agentRegistry` (calling
  each registration's `createAgent`), keyed by id, so `agentId={skin.id}`
  resolves the right agent. Its `identifyUser` callback delegates per skin (see
  the boundary section above). Env-gated: pure SSE `CopilotRuntime` +
  `InMemoryAgentRunner` by default (OSS path); a `CopilotKitIntelligence` runtime
  when `INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, and
  `INTELLIGENCE_API_KEY` are all set.

## The inset frame

`src/shell/layout/` owns the app's outer geometry. `ShellFrame` renders a padded
region holding **two** cards, separated by a resizable gutter:

- the **assistant column** — the selector card stacked above the chat card
- the **app card** — the active skin's `Layout` wrapping `CanvasRegion`

The model is deliberately just "one bounded panel, one that takes the remainder"
(`panel-sizes.ts`): the assistant is `min 250px / default 600px / max 50%`, and the
app gets what is left. Capping the assistant as a SHARE is what removes the need for
an app floor and lets the mobile breakpoint stay a genuine 768px rather than being
derived from panel arithmetic.

Things worth knowing before changing any of it:

- **The thread rail is NOT a resizable panel** — it is a fixed 200px element inside
  the chat card (`.nw-chat-rail`), hidden by a container query when the card gets
  narrow. It used to be a nested panel, which made the assistant's floor a compound
  of rail + conversation and produced a cascade of breakpoint and collapse bugs.
- **`react-resizable-panels` is pinned to 4.x**, whose API is renamed from the 2.x/3.x
  used elsewhere in this repo: `Group`/`orientation`/`Separator`/`useDefaultLayout`.
  Bare-number sizes are **pixels** in 4.x (3.x is percentage-only), which is why the
  pin exists. A `Panel`'s `className` lands on a **nested** div, so panel geometry
  must come from `minSize`/`defaultSize`/`collapsedSize` and never from classes; the
  emitted style hooks are `data-group` / `data-panel` / `data-separator`. See the
  header comment in `src/components/ui/resizable.tsx`, and treat the type
  declarations in `node_modules` as the authority over any doc site.
- **Shell controls live in the selector card** — skin switcher, swap sides, hide.
  The chat header holds only conversation actions. Collapsing hides the whole
  column, selector included, and a launcher restores it. On a `LOCK_SKIN` deploy
  the switcher becomes a static brand badge (`skin-brand-locked`) while swap and
  hide stay — a disabled dropdown was rejected as implying a choice that does not
  exist.
- **`.nw-panel-card` is a fixed 12px radius in px** and deliberately does not read
  `--radius`: the frame is shell chrome and must read identically in every skin.
  Card colours stay themed, so a reskin still restyles the frame.
- **Skin layouts must root at `h-full`, not `h-screen`** — they fill the app card,
  which the frame has already inset.

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

## The six skins (why they differ)

Two substrates behind one contract is the architectural demonstration. Demo
completeness is a **separate axis**, and the two do not correlate — see the beat
matrix at the end of this section.

- **`banking`** ("Northwind Finance") — **REST-backed**, and the reference demo.
  Its pages, tools, and report canvas read a live ledger over
  `/api/banking/v1/*` (cards, transactions, users, policies, exceptions, reports,
  and a gated `dev/reset`). It uses the optional `Providers`, `CanvasSurface`,
  `sandboxFunctions`, `chatHeaderActions` (a paperclip that stages a bundled Q2
  invoice PDF), `onSuggestionSelect` (the Q2 pill drives the real composer so the
  invoice rides as an attachment), and — to scope durable memory per member —
  `RuntimeProviders` (hoists its `AuthContextProvider` above the provider) +
  `useRuntimeProperties` (returns `{ userRole, userId }`) on the client plus a
  server-safe `identifyUser` in the agent registry. It **omits** `useData` — its
  components read the REST ledger via `useCreditCards` and the current member via
  `useAuthContext` directly, so nothing flows through `useSkinData`. It was the
  FIRST skin with a route readable, per-page on-screen readables, seeded memories
  and the teach-mode loop (`docs/teach-mode/`) — it is no longer the only one:
  `people` and `commerce` have all four too, as the beat matrix below and
  `docs/teach-mode/README.md` both say. Which skins have which is derivable, so
  derive it rather than trusting a sentence:
  `grep -rln useAgentContext src/skins/*/layout.tsx` (route readable),
  `ls src/skins/*/intelligence/seed-memories.ts` (seeded memories), and
  `grep -l offerWorkflowRecording src/skins/*/tools.tsx` (teach mode).
- **`logistics`** ("Meridian") — **REST-backed**. A freight control tower for
  exception triage (expedite / reroute / split / absorb) across pages
  `control-tower` (index), `lanes`, `inventory`, `decisions`. Like banking it
  **omits `useData`**, reading its ledger via `useLogistics()` and the planner via
  `usePlannerAuth()`. Sets `RuntimeProviders`, `useRuntimeProperties`,
  `Providers`, `CanvasSurface` (fed by the server tool `renderBrief`),
  `sandboxFunctions`, `toolLabels` and a server `identifyUser`; omits
  `chatHeaderActions` and `onSuggestionSelect`. **The debugged reference for skin
  layout chrome** — the `h-full overflow-hidden` root and the meta-utility strip
  were fixed here first.
- **`airline`** ("Aeronova") — **in-memory**. Its `useData` (`useAirlineData`) is
  a seed-backed React-state store with no backend; mutations (`selectSeat`,
  `issueBoardingPass`, `chooseRebooking`) update local state. It omits
  `Providers`, `CanvasSurface`, `sandboxFunctions`, `chatHeaderActions`,
  `onSuggestionSelect`, `RuntimeProviders`, `useRuntimeProperties`, and a server
  `identifyUser` — the minimal end of the contract (only `toolLabels` beyond the
  required fields).
- **`keel`** ("Keel") — **in-memory**, Harbor Point Health's knowledge and
  operations desk. Sets `useData: useKeelData` (a `useState` store over
  `seedKeelRuns`), plus `CanvasSurface` (server tool `render_ops_report`),
  `sandboxFunctions`, `toolLabels`, `RuntimeProviders`, `useRuntimeProperties`
  and a server `identifyUser`; omits `Providers`, `chatHeaderActions`,
  `onSuggestionSelect`. **The only skin with parameterized routes** —
  `resolvePage` is Map-based and resolves `knowledge/<docId>` → `DocumentPage` and
  `runs/<runId>` → `RunDetailPage` alongside its static segments.

- **`people`** ("Rowan") — **REST-backed**, a People Ops command center, and the
  second skin built demo-complete against the full beat list. Pages `roster`
  (index), `compensation`, `requests`, `onboarding`, over `/api/people/v1/*`
  (one `ledger` snapshot read plus the write paths, a generated `offer-letter`
  PDF, and a gated `dev/reset`). Like banking and logistics it **omits
  `useData`**, reading the ledger through its own `usePeopleLedger()` context —
  mounted in `RuntimeProviders` rather than `Providers`, so the single fetch also
  feeds `useRuntimeProperties`. Sets `Providers` (teach-mode recording),
  `CanvasSurface` (server tool `render_people_brief`), `sandboxFunctions`,
  `toolLabels`, `chatHeaderActions`, `onSuggestionSelect` and a server
  `identifyUser`. Its teachable gate is approving an **out-of-band** compensation
  request (422 `OUT_OF_BAND`), unlocked by a band exception filed under a
  justifying code; two out-of-band requests are seeded so the case taught on
  stage and the unaided replay are different people. Its beat map is written out
  at the top of `src/skins/people/suggestions.ts`.

- **`commerce`** ("Bellwether") — **REST-backed**, a storefront operations
  console for a DTC retail brand, and the third skin built demo-complete against
  the full beat list. Pages `orders` (index), `catalog`, `promotions`, `returns`,
  over `/api/commerce/v1/*` (one `ledger` snapshot read plus the write paths, a
  generated `price-sheet` PDF, and a gated `dev/reset`). Like banking, logistics
  and people it **omits `useData`**, reading the ledger through its own
  `useCommerceLedger()` context — mounted in `RuntimeProviders` rather than
  `Providers`, so the single fetch also feeds `useRuntimeProperties`. Sets
  `Providers` (teach-mode recording), `CanvasSurface` (server tool
  `render_trade_brief`), `sandboxFunctions`, `toolLabels`, `chatHeaderActions`,
  `onSuggestionSelect` and a server `identifyUser`. Its signature visual is the
  **margin ladder** — one rail per category, each anchored to that category's own
  margin floor, so "how far from the line I may not cross" is comparable across
  categories at a glance. Its teachable gate is approving a markdown that would
  trade **below the category margin floor** (422 `BELOW_MARGIN_FLOOR`), unlocked
  by a margin waiver filed under a justifying code; two below-floor markdowns are
  seeded so the case taught on stage and the unaided replay are different
  products. **The reference for a four-lever navigation** (beat 3c): status,
  exception class, sort and top-N all arrive from the query string and all four
  controls tint. Its beat map is written out at the top of
  `src/skins/commerce/suggestions.ts`.

### Demo-beat coverage (the other axis)

| Beat                             | banking                   | people                    | commerce                  | airline | logistics     | keel          |
| -------------------------------- | ------------------------- | ------------------------- | ------------------------- | ------- | ------------- | ------------- |
| Gen-UI in transcript             | ✅ 9                      | ✅ 4                      | ✅ 4                      | ✅ 6    | ✅ 5          | ✅ 4          |
| Rich thread survives reload      | ✅ replay-safe tools      | ✅ replay-safe tools      | ✅ replay-safe tools      | ❌      | ❌            | ❌            |
| Drive the app, secret withheld   | ✅                        | ✅                        | ✅                        | ❌      | ❌            | ❌            |
| "What's on my screen?"           | ✅ route + page readables | ✅ route + page readables | ✅ route + page readables | ❌      | ❌            | ❌            |
| Navigate via levers + filters    | ✅                        | ✅                        | ✅ four levers            | ❌      | ❌            | nav only      |
| Multimodal → durable artifact    | ✅                        | ✅                        | ✅                        | ❌      | ❌            | ❌            |
| Long-term memory recall          | ✅                        | ✅                        | ✅                        | ❌      | plumbing only | plumbing only |
| Stored-procedure replay          | ✅                        | ✅                        | ✅                        | ❌      | ❌            | ❌            |
| Teach a new procedure            | ✅                        | ✅                        | ✅                        | ❌      | ❌            | ❌            |
| Presenter reset (route + button) | ✅                        | ✅                        | ✅                        | ❌      | ✅            | ❌            |

`banking`, `people` and `commerce` hit every row; airline, logistics and keel
predate this bar and hit about one each (nine beats plus the presenter-reset
requirement are listed above). Note that logistics and keel ship the **full
per-user identity plumbing** — `RuntimeProviders`, `useRuntimeProperties`, server
`identifyUser` — and then no memory prompts, no memory tools and no seed file, so
they get no demo value from the hardest part of it. Treat all three as excellent
**wiring** references and incomplete **demo** references.

## How to add a skin

Use the repo-local skill in `.claude/skills/reskin/` — it walks the full
authoring flow. In short:

1. **Map the demo beats first**, before any code — the table template is in
   [`.claude/skills/reskin/demo-beats.md`](.claude/skills/reskin/demo-beats.md).
   The demo decides the tools, the pages, the prompt and the pills; discovering
   the beats afterwards means rebuilding them.
2. Scaffold `src/skins/<id>/` and implement each `Skin` contract field.
3. Write `src/skins/<id>/theme.css` (a `.theme-<id>` block re-valuing shared
   tokens) and side-effect-import it from the skin's `layout.tsx`.
4. Add a server-safe `src/skins/<id>/agent.ts` (no `"use client"`, no JSX). The
   prompt is where most beats are actually enforced.
5. Register in **both** `src/shell/registry.ts` (client skin) and
   `src/shell/agent-registry.ts` (as `{ createAgent, identifyUser? }`), keyed by
   the identical `id` — and append the id to `LINTED_SKIN_IDS` in
   `eslint.config.mjs`, or the LOCK_SKIN lint guard never looks at your skin.
   Then append the same id to `skinIds` in `src/shell/skins-config.ts`, or
   `LOCK_SKIN=<id>` is rejected at boot, plus an entry to `skinIdentities` in
   that same file carrying your `identity.brand` and `identity.tagline`
   verbatim — that map, not your skin module, is what a locked deploy's
   `<title>` and `<meta name="description">` come from. **Only some of those
   sites are guarded, so read this before trusting a green tree.**
   `skins-config.test.ts` compares `LINTED_SKIN_IDS`, `skinIds` and
   `skinIdentities` against `registry.ts` and fails on any of the three (a
   missing `skinIdentities` entry additionally fails `pnpm build`, because that
   map is typed `Record<(typeof skinIds)[number], …>`). `registry.ts` is the
   thing they are all compared TO, so it cannot drift — forget it and your skin
   simply does not exist (no selector entry, `/<id>` 404s). **`agent-registry.ts`
   has no drift guard at all**: nothing imports it from a test
   (`grep -rln agentRegistry src --include='*.test.*'` is empty) and its
   `Record<string, AgentRegistration>` type accepts a missing key, so a skin
   wired everywhere else renders fine and only fails when someone sends a chat
   message. Check that one by hand, or by step 5 of the skill's Verification
   list.
6. If the skin scopes Intelligence per end-user, add its client
   `RuntimeProviders` + `useRuntimeProperties` and a server-safe `identifyUser`.
   If it has memory or stored-procedure beats, add
   `intelligence/seed-memories.ts` and re-seed from its `dev/reset` route.
7. Ship one suggestion pill per beat, in demo order — the presenter should never
   have to type.
8. Optionally set `defaultSkinId` in `src/shell/skins-config.ts`.

## Commands

Real scripts from `package.json` (there is no `typecheck` script — `pnpm build`
type-checks as part of `next build`):

- `pnpm dev` — run the app (needs `OPENAI_API_KEY`; copy `.env` from
  `.env.example`). Visit `/`, which redirects to the default skin.
- `pnpm build` — production build (also the type-check gate).
- `pnpm start` — serve the production build.
- `pnpm lint` — ESLint. Also carries the LOCK_SKIN URL-contract guard (the
  `no-restricted-syntax` skin-prefix selectors in `eslint.config.mjs`).
- `pnpm test:unit` — Vitest unit tests.
- `pnpm test:e2e` / `pnpm test:e2e:ogui` / `pnpm test:self-learning` — Playwright
  suites. `test:e2e` has TWO projects, each with its own dev server, because the
  lock is a boot-time server env and the two deploy shapes are therefore two
  processes: **`unlocked`** (port 3000, `LOCK_SKIN=""`) runs every spec except
  `locked-skin.spec.ts`; **`locked`** (port 3100, `LOCK_SKIN=banking`, its own
  `.next-locked` build dir) runs only that one. Target one with
  `--project=locked`. The locked project exists because LOCK_SKIN's headline
  behaviour has no other coverage — a link that keeps the skin prefix still
  renders a working page, so only a browser against a locked server catches it.
- `pnpm mint-dev-license` — mint a dev license (Intelligence mode).

Run tasks through Nx per the repo convention where applicable.

## Reference

- `src/shell/skin-contract.ts` — the contract (source of truth).
- `src/skins/{banking,logistics,airline,keel,people,commerce}/skin.tsx` — six
  implementations. Open `banking`, `people` or `commerce` for demo completeness,
  `logistics` for layout chrome and the server-emitted a2ui canvas, `airline` for
  the minimal contract surface, `keel` for parameterized routes.
- `.claude/skills/reskin/` — the authoring skill: `SKILL.md` (contract + wiring
  traps), `demo-beats.md` (what the demo must prove, and the quality bar),
  `templates.md` (per-file starting points).
- `docs/DESIGN.md` — the banking skin's visual design system ("Aurora").
- `docs/teach-mode/` — the banking skin's teachable over-limit-approval flow, plus
  `verify-teachable-gate.sh` which proves the gate → unlock path over pure REST.
- `docs/superpowers/` — plans and specs for this app's own development.
