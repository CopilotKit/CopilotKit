# Reskinnable Demo — architecture

One Next.js app whose **entire** experience — brand, theme, layout, pages,
tools, and agent — is reskinnable at runtime. A skin-agnostic **shell** hosts
one **skin** per route segment `/[skin]/...`. The registered roster is `banking`,
`airline`, `logistics`, `keel`, `people`, `commerce` and `bookstore` — switchable
from a dropdown at the top of the assistant column, plus a repo-local **reskin
skill** (`.claude/skills/reskin/`) for authoring new ones.

The point of the app is the `Skin` contract: a single interface that swaps a
whole product without the shell knowing anything domain-specific. The contract is
**substrate-agnostic**: swapping a skin's data substrate touches nothing outside
`src/skins/<id>/` — no contract field, no shell file, and the skin keeps its id,
its routes, its theme and its agent.

**Both substrates are live**, so derive the split instead of memorising it:

```bash
grep -l 'useData:' src/skins/*/skin.tsx   # in-memory: state held in the shell
find src/app/api -name route.ts -not -path '*/dev/*' -not -path '*copilotkit*' \
  | cut -d/ -f4 | sort -u                 # REST-backed: the skins with a ledger
```

The two lists are disjoint and together cover the roster. Most of it is
REST-backed; a `useData` skin's own `v1/` carries only `dev/reset`, which is why
the second command excludes that path. `useData` therefore has a worked example
in the tree and not merely a template — see its row in the contract table below.

**Each skin is also a live sales demo.** It exists to prove CopilotKit and
Intelligence top to bottom to an enterprise buyer, through a fixed set of demo
**beats**: lead with generative UI, show that threads store AG-UI streams rather
than text, manipulate the app four ways (drive it, read the screen, navigate via
real levers, ingest a document into a durable artifact), recall long-term memory,
replay a stored procedure, and learn a new one on stage. **Every registered skin
but `bookstore` is demo-complete**, and bookstore's two blanks are a DIRECTION
rather than an oversight — its beat map marks multimodal ingest and
teach-a-procedure `SKIPPED` instead of deleting the rows. The per-beat matrix at
the end of "The skins" is the derivation, and `banking` is the reference
implementation. The
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
compiles, lints and renders. A template teaching a pattern the code no longer has,
and a verification step naming a gate that no longer exists, both pass every gate
in this tree. Updating the authoring half and not the VERIFICATION half is the
common shape of it.

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

Defined in `src/shell/skin-contract.ts` (the interface is frozen). Every field
below is exactly as declared there.

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

| Field                   | Type                                                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Providers?`            | `ComponentType<{ children: ReactNode }>`             | Escape hatch: a skin-specific provider stack mounted **below** `CopilotKitProvider`, for anything that must consume CopilotKit context. Every registered skin sets it (`grep -lE '^\s+Providers[,:]' src/skins/*/skin.tsx`) — each mounts the shell's teach-mode `RecordingProvider` there, because beat 6's recorder is the one context that must enclose BOTH the app card and the chat card, and most also mount the ledger context their OGUI sandbox functions read. A skin that omits it gets a shell pass-through.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `CanvasSurface?`        | `ComponentType`                                      | Renders this skin's own a2ui report surface full-region on the shared canvas. Omit if the skin has no a2ui report canvas — every shipped skin sets it and files a brief (`grep -lE '^\s+CanvasSurface[,:]' src/skins/*/skin.tsx`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `sandboxFunctions?`     | `SandboxFunction[]`                                  | Functions exposed inside OGUI sandboxed iframes for this skin (e.g. banking's spend-data getters). Set by every skin except `airline` (`grep -lE '^\s+sandboxFunctions[,:]' src/skins/*/skin.tsx`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `toolLabels?`           | `Record<string, string>`                             | Human labels for this skin's own tool-activity chips, keyed by tool name. Unlisted tools fall back to a prettified raw name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `chatHeaderActions?`    | `ChatHeaderAction[]`                                 | Buttons this skin contributes to the shared chat header, drawn before the shell's own controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `onSuggestionSelect?`   | `(suggestion: Suggestion, index: number) => boolean` | Intercepts a suggestion click. Return `true` if the skin fully handled it (the shell does nothing further); return `false`/omit for the default "send the message" path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `RuntimeProviders?`     | `ComponentType<{ children: ReactNode }>`             | Provider stack mounted **above** `CopilotKitProvider` (unlike `Providers`, which mounts below). The sanctioned place to establish any context `useRuntimeProperties` must read — the identity source must sit above the provider so the provider owns the property bag from its first commit (no child racing `setProperties`). Banking hoists its `AuthContextProvider` here. `airline` is the one skin that sets `useRuntimeProperties` and NOT this — deliberately: it has one account holder and no switcher, so its hook reads no context and returns a frozen module constant (`src/skins/airline/runtime-properties.ts`). Needing `useRuntimeProperties` does not imply needing this.                                                                                                                                                                                                                                         |
| `useRuntimeProperties?` | `() => Record<string, unknown> \| undefined`         | Contributes this skin's runtime `properties`. The shell calls it inside `RuntimeProviders` (above `CopilotKitProvider`) and threads the result straight into `CopilotKitProvider`'s `properties` prop — this is how a skin scopes its Intelligence runs / durable memory per end-user without the shell reaching into skin internals. Return a stable/memoized object; banking returns `{ userRole, userId }`. Omit if the skin contributes no runtime identity. Every registered skin sets it (`grep -lE '^\s+useRuntimeProperties[,:]' src/skins/*/skin.tsx`).                                                                                                                                                                                                                                                                                                                                                                     |
| `useData?`              | `() => unknown`                                      | Seed-backed data hook; the shell runs it in `SkinProvider`, components read it via `useSkinData<T>()`. **The in-memory escape hatch — the minority path, with a live worked example.** Derive who takes it, do not trust a list: `grep -l 'useData:' src/skins/*/skin.tsx` names the implementors (`bookstore` today, via `src/skins/bookstore/data/use-data.ts`) and `grep -rn 'omits `useData`\|useData' src/skins/*/skin.tsx` shows the rest recording the omission in a comment. In a skin that omits it `useSkinData<T>()` returns `undefined`, and the skin reads its own ledger through its own context/hook instead — banking `useCreditCards` + `useAuthContext`, logistics `useLogistics()`, people `usePeopleLedger()`, commerce `useCommerceLedger()`, airline `useAirlineLedger()`, keel `useKeelLedger()` + `useKeelDesk()`. For writing one, read the implementor first and templates.md § `data/use-data.ts` second. |

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

- **Every registered skin contributes one, and every one uses it for durable
  memory.** Derive that rather than trusting this sentence — `ls
src/skins/*/intelligence/user-id.ts` and `ls
src/skins/*/intelligence/seed-memories.ts` return the same set. The fallback path
  in the route is therefore unreachable from the registry today and is kept for
  skins that do not exist yet.
- **Per-user scoping is real plumbing and mostly NOT a demoable contrast.** Read
  the skin's own `intelligence/user-id.ts` before claiming anything about it on
  stage; each one's header is the authority. The recurring measured fact, written
  down in every skin's alike: the client's `properties` frequently do not reach
  `identifyUser` on a run, so both personas land in the same default bucket and
  switching operator/planner/shopper in the sidebar re-scopes NOTHING. That is
  exactly why the seeding always covers the **default** bucket, and in every skin
  but banking the mapped identity's alongside it (`grep -n DEMO_DEFAULT_USER_ID
src/app/api/*/v1/dev/reset/route.ts` is the check).
  `airline` is a second special case for a different reason: one
  account holder, no switcher, so its resolver is not a "switch user and watch
  memory change" story at all.
- Every skin that claims the memory beats additionally ships
  `intelligence/seed-memories.ts` and `intelligence/forget-memories.ts`, which its
  `dev/reset` route uses to wipe learned memories and re-seed the ones the demo
  must start out already knowing. That pair is what makes the long-term-memory
  and stored-procedure-replay beats work; it is not emergent behaviour. Derive
  the set rather than trusting a list: `ls
src/skins/*/intelligence/seed-memories.ts`, and pair it with `ls -d
src/app/api/*/v1/dev/reset` for the reset routes. Check BOTH, because a reset
  route without a seed file restores its data store only and cannot restore the
  memory beats — a silent trap, since its Reset button looks identical. A
  `useData` skin inverts that: with no server-side store there is nothing to
  restore, so its reset route touches memory ONLY and the client clears its own
  browser state before reloading (bookstore's `localStorage` cart is the worked
  example).
- **Scope a learned procedure `user`, not `project`** — and the two halves have to
  agree. Project scope is GLOBAL to the shared Intelligence instance (one backend,
  every skin), so a sweep that deletes project rows deletes a sibling skin's seeds.
  Every skin bar banking therefore has a `forget-memories.ts` that SKIPS them
  (`grep -ln 'scope !== "project"' src/skins/*/intelligence/forget-memories.ts`),
  and in such a skin a project-scoped memory **survives every presenter reset** —
  save beat 6's procedure there and the second run of the day opens already-taught:
  the agent never declines, never offers to record, and the beat proves nothing
  while looking perfect. Banking is self-consistent the other way (project scope +
  a sweep that deletes everything) and is the one exception, not the pattern;
  every other skin scopes `user`
  (`grep -n 'scope:' src/skins/*/intelligence/seed-memories.ts`, where each records
  the reasoning beside the field).
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
  every registered skin through the real selectors — without it, an unlisted id is
  simply unlinted and lint stays green.
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
  `showDevConsole={true}`, which surfaces `CopilotKitInspector`. A skin
  contributes nothing to it. Not part of the standard demo flow, but the thing to
  open when a technical audience wants to see the actual AG-UI event stream, or
  when debugging one.
- `src/app/[skin]/[[...rest]]/page.tsx` — renders `skin.resolvePage(rest)`, or a
  404 when it returns `null`. `resolvePage` receives **all** remaining segments, so
  a skin can resolve parameterized routes — `keel` is the worked example
  (`knowledge/<docId>`, `runs/<runId>`), and `bookstore` the smaller one
  (`book/<slug>`, which resolves for ANY slug so a stale deep link renders a
  "not found" body rather than a 404).
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
  narrow. Nesting it as a panel makes the assistant's floor a compound of rail +
  conversation, which cascades into breakpoint and collapse bugs.
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
  renders nothing for that kind; every shipped skin has one, so that branch is
  currently unexercised.

Gen-UI components registered via `useComponent` (airline's flight card, banking's
charts and queues) render in the chat transcript, not on the canvas — that is a
separate path from the full-region canvas surfaces above.

## The skins (why they differ)

Many products behind one contract is the architectural demonstration
(`ls src/skins/` is the roster; do not quote a number at it). All but `bookstore`
are REST-backed and all but `bookstore` are demo-complete, so what mostly differs
between them is DOMAIN and which piece of the contract each one is the cleanest
worked example of — not tier. The beat matrix at the end of this section is the
check.

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
  `useAuthContext` directly, so nothing flows through `useSkinData`. Its
  teach-mode loop is written up in `docs/teach-mode/`. **Every registered skin has
  a route readable, per-page on-screen readables and seeded memories; the teach-mode
  loop is the one of the four a skin can skip.** Which skins have which is
  derivable, so derive it rather than trusting a sentence:
  `grep -rln useAgentContext src/skins/*/layout.tsx` (route readable),
  `grep -rln useAgentContext src/skins/*/pages/` (on-screen readables),
  `ls src/skins/*/intelligence/seed-memories.ts` (seeded memories), and
  `grep -l offerWorkflowRecording src/skins/*/tools.tsx` (teach mode — the only
  one of the four that does NOT return the whole roster).
- **`logistics`** ("Meridian") — **REST-backed**. A freight control tower for
  exception triage (expedite / reroute / split / absorb) across pages
  `control-tower` (index), `lanes`, `inventory`, `decisions`. Like banking it
  **omits `useData`**, reading its ledger via `useLogistics()` and the planner via
  `usePlannerAuth()`. Sets `RuntimeProviders`, `useRuntimeProperties`,
  `Providers` (the OGUI sandbox sync plus the shell's teach-mode
  `RecordingProvider`), `CanvasSurface` (fed by the server tool `renderBrief`),
  `sandboxFunctions`, `toolLabels`, `chatHeaderActions` + `onSuggestionSelect`
  (beat 3d — they stage the carrier rate sheet into the composer) and
  a server `identifyUser`. **The reference for skin layout chrome** —
  the `h-full overflow-hidden` root and the meta-utility strip. Its teachable
  gate is committing a mitigation **over the planner's
  approval authority** (403 `OVER_AUTHORITY`), unlocked by an escalation filed
  under a justifying code; two over-authority shipments are seeded so the case
  taught on stage and the unaided replay are different freight, and
  `data/blocked-by-authority.test.ts` fails if that ever drops to one. The one place its
  withheld code vocabulary legitimately appears is the planner filing form,
  `components/escalation-form.tsx`.
- **`airline`** ("Aeronova") — **REST-backed**, and deliberately PASSENGER-FACING:
  a traveller's own concierge, not an agent console (`bookstore` is the other
  consumer-facing skin). Pages
  `""` (Trip), `account`, `rebook`, `loyalty`, `disruptions`, over
  `/api/airline/v1/*` (one `ledger` snapshot read plus the write paths, a bundled
  hotel confirmation, and a gated `dev/reset`). Like the others it **omits
  `useData`**: components read `useAirlineLedger()` (projected onto the check-in
  shapes by `components/concierge-view.ts`). Sets `Providers`,
  `CanvasSurface` (server tool `render_trip_brief`), `toolLabels`,
  `chatHeaderActions`, `onSuggestionSelect`, `useRuntimeProperties` and a server
  `identifyUser`. **Its two remaining omissions are the interesting part of it**:
  no `sandboxFunctions`, and no `RuntimeProviders` even though it DOES contribute
  `useRuntimeProperties` — there is one account holder and no switcher, so the hook
  reads no context and returns a frozen module constant. It is therefore the worked
  example of contributing runtime identity WITHOUT a provider above the tree.
  Its gate is **entitlement, not authority**: a fare whose conditions do not permit
  the change (422 `FARE_NOT_CHANGEABLE`), lifted only by an exception whose category
  MATCHES what the booking's own record documents (`data/fare-rules.ts`'s
  `exceptionLifts`), so the learned procedure is "read what the booking documents,
  file the matching category" rather than a memorized literal. **It also has a
  beat-6 vocabulary channel no other skin has** — `Booking.waiverGround`, a
  code-shaped token that `store.snapshot()` strips on purpose. Its beat map is
  `src/skins/airline/data/beat-map.md`.
- **`keel`** ("Keel") — **REST-backed**, Harbor Point Health's knowledge and
  operations desk. Pages `""` (Desk), `knowledge` (labelled **Register**),
  `playbooks`, `runs`, over `/api/keel/v1/*`. Sets `CanvasSurface` (server tool
  `render_ops_report`), `sandboxFunctions`, `toolLabels`, `Providers`,
  `RuntimeProviders`, `useRuntimeProperties`, `chatHeaderActions`,
  `onSuggestionSelect` and a server `identifyUser`. It **omits `useData`**: runs
  and the policy register are ONE ledger read through `useKeelLedger()` /
  `useKeelDesk()`, and — the load-bearing part — **elapsed run time is settled
  SERVER-SIDE on every read**
  (`src/app/api/keel/v1/settle-runs.ts`, called by both `GET /ledger` and `GET
/runs/[runId]`), so the client interval only re-reads. A client-side ticker would
  be a second clock, painting progress the server never heard of and rewinding on
  the next re-read. **The fullest parameterized routing** — `resolvePage` is
  Map-based and resolves `knowledge/<docId>` → `DocumentPage` and `runs/<runId>` →
  `RunDetailPage` alongside its static segments; `bookstore` takes the same shape
  for its single `book/<slug>`. Its gate is who may **RELEASE** a
  policy revision (403 `UNENDORSED_REVISION`), unlocked by a publication variance
  filed under a justifying code; note beat 3a's PIN countersign and beat 6's gate
  touch the SAME write, which is the collision failure-modes.md § 12 warns about,
  so the countersign route re-runs the release gate. Its beat map is
  `src/skins/keel/data/beat-map.md`; its pill-to-beat table is at the top of
  `src/skins/keel/suggestions.ts`.

- **`people`** ("Rowan") — **REST-backed**, a People Ops command center, authored
  beat-first against the full beat list. Pages `roster`
  (index), `compensation`, `requests`, `onboarding`, over `/api/people/v1/*`
  (one `ledger` snapshot read plus the write paths, a generated `offer-letter`
  PDF, and a gated `dev/reset`). Like the others it **omits
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
  console for a DTC retail brand, authored beat-first against the full beat list.
  Pages `orders` (index), `catalog`, `promotions`, `returns`,
  over `/api/commerce/v1/*` (one `ledger` snapshot read plus the write paths, a
  generated `price-sheet` PDF, and a gated `dev/reset`). Like the others it
  **omits `useData`**, reading the ledger through its own
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

- **`bookstore`** ("Bookstore") — **in-memory**, an online bookshop, and the one
  skin that is not demo-complete, by DIRECTION. It is also not a second
  `commerce`: commerce is the merchant's operations console (orders, catalog,
  promotions, returns), bookstore is the shopper's own storefront — the two
  consumer-facing skins are this one and `airline`. Its routes are the index shelf
  (also reachable as `browse`), the parameterized `book/<slug>`, and `cart`.
  **It is the tree's only `useData` implementor** (`grep -l 'useData:'
src/skins/*/skin.tsx`): `useBookstoreData` is a frozen 25-book seed catalog (the
  25th is the club pick's paperback edition, sharing a `workId` with its hardcover —
  that shared id is what makes the edition swap demonstrable) plus a cart/orders
  store mirrored to `localStorage` **per shopper**, which is what lets the basket
  survive the hard reload beat 2 turns on. Also sets `RuntimeProviders` +
  `useRuntimeProperties` (a Maya/Guest shopper switcher in the sidebar, forwarding
  `{ userId, userRole }`), `toolLabels` and a server `identifyUser`; omits
  `Providers`, `CanvasSurface`, `sandboxFunctions`, `chatHeaderActions` and
  `onSuggestionSelect` — no canvas, no OGUI, no attachment path. Its agent registers
  NO backend tools (`tools: []`): the catalog reaches it as context, `showBooks` and
  `recommendBooks` are `useComponent` cover-card renders, and `browseWithFilters` /
  `openCheckout` are HITL (the shopper types the card number into the checkout card
  and only the last four digits ever leave it). Its beat map — including the two
  rows marked `SKIPPED`, multimodal ingest and teach-a-procedure — is written out at
  the top of `src/skins/bookstore/suggestions.ts`. **Read the runtime warning there
  before demoing it:** beats 2, 4 and 5 are three of its four headline claims and all
  three exist only in Intelligence mode — the OSS path leaves a pretty storefront
  with a chatbot. Beat 4 is the RECALL — the agent applies a seeded taste nobody
  typed and names it in `recommendBooks`' `note` slot — and NOT a Maya-vs-Guest
  contrast: switching shopper does not re-scope memory (see the `identifyUser`
  bullet above and the CAVEAT in `.env.example`).

### Demo-beat coverage

| Beat                             | banking              | people               | commerce             | airline                | logistics            | keel                   | bookstore                  |
| -------------------------------- | -------------------- | -------------------- | -------------------- | ---------------------- | -------------------- | ---------------------- | -------------------------- |
| Gen-UI in transcript             | ✅                   | ✅                   | ✅                   | ✅                     | ✅                   | ✅                     | ✅                         |
| Rich thread survives reload      | ✅ replay-safe tools | ✅ replay-safe tools | ✅ replay-safe tools | ✅ replay-safe tools   | ✅ replay-safe tools | ✅ replay-safe tools   | ✅ replay-safe tools       |
| Drive the app, secret withheld   | ✅ card PIN          | ✅                   | ✅                   | ✅ card on file        | ✅ planner PIN       | ✅ countersign PIN     | ✅ card, last four only    |
| "What's on my screen?"           | ✅ route + page      | ✅ route + page      | ✅ route + page      | ✅ route + page        | ✅ route + page      | ✅ route + page        | ✅ route + page            |
| Navigate via levers + filters    | ✅                   | ✅                   | ✅ four levers       | ✅ four levers         | ✅ four levers       | ✅                     | ✅ four levers             |
| Multimodal → durable artifact    | ✅ Q2 invoice        | ✅ offer letter      | ✅ price sheet       | ✅ hotel confirmation  | ✅ rate sheet        | ✅ regulatory bulletin | ❌ skipped by direction    |
| Long-term memory recall          | ✅                   | ✅                   | ✅                   | ✅                     | ✅                   | ✅                     | ✅                         |
| Stored-procedure replay          | ✅                   | ✅                   | ✅                   | ✅                     | ✅                   | ✅                     | ✅ seeded op-memory replay |
| Teach a new procedure            | ✅ over-limit        | ✅ out-of-band       | ✅ below-floor       | ✅ fare not changeable | ✅ over-authority    | ✅ unendorsed revision | ❌ skipped by direction    |
| Presenter reset (route + button) | ✅                   | ✅                   | ✅                   | ✅                     | ✅                   | ✅                     | ✅                         |

**Every registered skin hits every row except `bookstore`, which hits every row it
claims and marks the other two `SKIPPED` in its own beat map** — read its two blanks
as a scope decision, not a gap to fill. The table is the WORST place to learn any of
that from: a matrix of ticks is prose and rots silently. So run the checks instead —
each is one command, and the shape of the answer is the signal:

```bash
grep -rln useAgentContext src/skins/*/layout.tsx     # beat 3b, the route readable
grep -rln useAgentContext src/skins/*/pages/         # beat 3b, the on-screen ones
ls src/skins/*/intelligence/seed-memories.ts         # beats 4 and 5, seeded
ls src/skins/*/intelligence/forget-memories.ts       # + the reset's memory half
grep -l offerWorkflowRecording src/skins/*/tools.tsx # beat 6, the teach loop
ls -d src/app/api/*/v1/dev/reset                     # the presenter-reset route
grep -rln usePresenterReset src/skins/               # …and its button
```

Every one of those returns the whole roster except the beat-6 teach loop, which
returns the roster minus `bookstore` — so a skin missing from any of the others is a
gap, and a skin missing from that one is a stated scope decision.

Two per-skin counts are worth deriving rather than tabulating, because they are the
two most often quoted wrongly:

```bash
# Gen-UI registrations. Count the whole skin folder, NOT just tools.tsx — banking
# registers one in `pages/cards.tsx`, so the tools.tsx-only form under-reports it.
for s in src/skins/*/; do printf '%s %s\n' "$s" "$(grep -rho 'useComponent(' "$s" --include='*.tsx' | wc -l)"; done

# Suggestion pills.
grep -c 'title:' src/skins/*/suggestions.ts
```

**A count predicts nothing about coverage in either direction**, which is why they
are not in the table. `bookstore` registers the FEWEST gen-UI components in the tree
and hits seven of the nine beats; `commerce` is near the bottom of the same list and
is one of the cleanest demo references in it; `keel` ships the most pills of any skin
for a reason that has nothing to do with beats (four identity pills that map to no
beat — the header of its `suggestions.ts` shows the arithmetic).

**The long-term-memory row means RECALL, in every column that claims it** — the
agent applying and naming a preference nobody typed on this thread. It does NOT
mean per-user isolation, and no skin can demo that: the client's `properties`
frequently do not reach `identifyUser` on a run, so the on-screen people collapse
into one default bucket and a user/operator/planner/shopper switcher re-scopes
nothing. That is why every skin with this beat seeds its DEFAULT bucket, and most
seed it alongside the mapped person's (`grep -rn "DEMO_DEFAULT_USER_ID" src/app/api/*/v1/dev/reset/route.ts`
is the check; banking is the one that seeds the default alone). Authorities: the
CAVEAT block in `.env.example`, the flagged comments in
`src/shell/agent-registry.ts`, and each skin's `intelligence/user-id.ts`.

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

Real scripts from `package.json`, plus one command that is NOT a script and is
still mandatory:

- **`pnpm typecheck` — the only full type-check in the tree. Run it.**
  There is no `typecheck` script, so it is easy to assume `pnpm build` covers it.
  It does not: `next build` type-checks only what the app's **module graph
  reaches**, so it never visits the test files (`find src e2e -name '*.test.ts*' |
wc -l`), and Vitest transpiles without type-checking at all. `tsconfig.json` DOES
  include `**/*.tsx`, so those files are in the project and nothing else looks at
  them. Treat the four gates as `pnpm lint` · `pnpm typecheck` ·
  `pnpm test:unit` · `pnpm build`, in that order (cheapest first).
- `pnpm dev` — run the app (needs `OPENAI_API_KEY`; copy `.env` from
  `.env.example`). Visit `/`, which redirects to the default skin.
- `pnpm build` — production build. It type-checks the app's own module graph, so
  it catches a broken page or tool; it is NOT the type-check gate for tests.
- `pnpm start` — serve the production build.
- `pnpm lint` — ESLint. Also carries the LOCK_SKIN URL-contract guard (the
  `no-restricted-syntax` skin-prefix selectors in `eslint.config.mjs`). It is
  **not** the whole gate: the repo root's `lefthook.yml` `pre-commit` hook
  additionally runs `oxlint --fix` and `oxfmt --write` over staged files and
  re-stages the result (`stage_fixed: true`), enforcing rules ESLint does not —
  e.g. the repo root's `.oxlintrc.json` sets
  `import/consistent-type-specifier-style: "prefer-top-level"`, which splits a
  merged `import { x, type Y }` into two statements. Practically: a change can
  satisfy `pnpm lint` and still be silently rewritten at commit time. Run
  `pnpm exec oxlint --fix` + `oxfmt --write` on your changed files before
  committing to see that rewrite up front instead of after.
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
- `src/skins/{banking,airline,logistics,keel,people,commerce,bookstore}/skin.tsx`
  — seven implementations. (`ls src/skins/` re-derives that roster; the drift
  guard in `src/shell/skin-roster-docs.test.ts` fails if the list above falls
  behind the registry, which is what makes writing it out safe here.)
  Open them for what each is the CLEANEST example of: `banking` the
  reference and the richest gen-UI set, `people` and `commerce` beat-first authoring
  with the beat map written out in `suggestions.ts`, `commerce` also a four-lever
  navigation, `logistics` layout chrome and the server-emitted a2ui canvas,
  `airline` runtime identity WITHOUT `RuntimeProviders` plus an entitlement-shaped
  (rather than authority-shaped) beat-6 gate, `keel` parameterized routes and a
  server-settled clock, `bookstore` the only `useData` implementor and a
  customer-facing storefront on an in-memory substrate.
- `.claude/skills/reskin/` — the authoring skill: `SKILL.md` (contract + wiring
  traps), `demo-beats.md` (what the demo must prove, and the quality bar),
  `templates.md` (per-file starting points), `failure-modes.md` (how a skin lies —
  read it before writing tools or pages).
- `docs/DESIGN.md` — the banking skin's visual design system ("Aurora").
- `docs/teach-mode/` — the banking skin's teachable over-limit-approval flow, plus
  `verify-teachable-gate.sh` which proves the gate → unlock path over pure REST.
- `docs/superpowers/` — plans and specs for this app's own development.
