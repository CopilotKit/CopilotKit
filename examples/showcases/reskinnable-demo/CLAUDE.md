# Reskinnable Demo — architecture

One Next.js app whose **entire** experience — brand, theme, layout, pages,
tools, and agent — is reskinnable at runtime. A skin-agnostic **shell** hosts
one **skin** per route segment `/[skin]/...`. It ships six skins — `banking`,
`airline`, `logistics`, `keel`, `people` and `commerce` — switchable from a
dropdown at the top of the assistant column, plus a repo-local **reskin skill**
(`.claude/skills/reskin/`) for authoring new ones.

The point of the app is the `Skin` contract: a single interface that swaps a
whole product without the shell knowing anything domain-specific.

**What now demonstrates that the contract is substrate-agnostic is the MIGRATION,
not a split.** The app used to run two data substrates side by side — four skins
on REST ledgers, `airline` and `keel` on in-memory `useState` stores behind
`useData` — and that co-existence was the standing proof. Both in-memory skins
have since moved onto their own REST ledgers, and the interesting part is what the
move cost: **nothing outside `src/skins/<id>/`.** No field of the `Skin` contract
changed, no shell file changed, and each kept its id, its routes,
its theme and its agent. A whole substrate was swapped underneath the
contract without the shell noticing — which is the stronger version of the same
claim.

Be clear about the consequence: **no in-memory skin remains.** All six are
REST-backed (`ls -d src/app/api/*/v1` names the six ledgers), and `useData` now
has zero implementors — see its row in the contract table below. A skin that
genuinely wants shell-managed client state can still set it; it just has no
worked example in the tree any more, only the template.

**Each skin is also a live sales demo.** It exists to prove CopilotKit and
Intelligence top to bottom to an enterprise buyer, through a fixed set of demo
**beats**: lead with generative UI, show that threads store AG-UI streams rather
than text, manipulate the app four ways (drive it, read the screen, navigate via
real levers, ingest a document into a durable artifact), recall long-term memory,
replay a stored procedure, and learn a new one on stage. `banking` is the original
reference implementation; every other skin was brought up to the same bar
afterwards, so **every registered skin is now demo-complete** — the per-beat
matrix at the end of "The six skins" is the derivation. The
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

| Field                   | Type                                                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Providers?`            | `ComponentType<{ children: ReactNode }>`             | Escape hatch: a skin-specific provider stack mounted **below** `CopilotKitProvider`, for anything that must consume CopilotKit context. Every registered skin sets it (`grep -lE '^\s+Providers[,:]' src/skins/*/skin.tsx`) — each mounts the shell's teach-mode `RecordingProvider` there, because beat 6's recorder is the one context that must enclose BOTH the app card and the chat card, and most also mount the ledger context their OGUI sandbox functions read. A skin that omits it gets a shell pass-through.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `CanvasSurface?`        | `ComponentType`                                      | Renders this skin's own a2ui report surface full-region on the shared canvas. Omit if the skin has no a2ui report canvas — no shipped skin does any more; all six file a brief (`grep -lE '^\s+CanvasSurface[,:]' src/skins/*/skin.tsx`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `sandboxFunctions?`     | `SandboxFunction[]`                                  | Functions exposed inside OGUI sandboxed iframes for this skin (e.g. banking's spend-data getters). Set by every skin except `airline` (`grep -lE '^\s+sandboxFunctions[,:]' src/skins/*/skin.tsx`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `toolLabels?`           | `Record<string, string>`                             | Human labels for this skin's own tool-activity chips, keyed by tool name. Unlisted tools fall back to a prettified raw name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `chatHeaderActions?`    | `ChatHeaderAction[]`                                 | Buttons this skin contributes to the shared chat header, drawn before the shell's own controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `onSuggestionSelect?`   | `(suggestion: Suggestion, index: number) => boolean` | Intercepts a suggestion click. Return `true` if the skin fully handled it (the shell does nothing further); return `false`/omit for the default "send the message" path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `RuntimeProviders?`     | `ComponentType<{ children: ReactNode }>`             | Provider stack mounted **above** `CopilotKitProvider` (unlike `Providers`, which mounts below). The sanctioned place to establish any context `useRuntimeProperties` must read — the identity source must sit above the provider so the provider owns the property bag from its first commit (no child racing `setProperties`). Banking hoists its `AuthContextProvider` here. `airline` is the one skin that sets `useRuntimeProperties` and NOT this — deliberately: it has one account holder and no switcher, so its hook reads no context and returns a frozen module constant (`src/skins/airline/runtime-properties.ts`). Needing `useRuntimeProperties` does not imply needing this.                                                                                                                                                                                                                                                                                                                |
| `useRuntimeProperties?` | `() => Record<string, unknown> \| undefined`         | Contributes this skin's runtime `properties`. The shell calls it inside `RuntimeProviders` (above `CopilotKitProvider`) and threads the result straight into `CopilotKitProvider`'s `properties` prop — this is how a skin scopes its Intelligence runs / durable memory per end-user without the shell reaching into skin internals. Return a stable/memoized object; banking returns `{ userRole, userId }`. Omit if the skin contributes no runtime identity. Every registered skin sets it (`grep -lE '^\s+useRuntimeProperties[,:]' src/skins/*/skin.tsx`).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `useData?`              | `() => unknown`                                      | Seed-backed data hook; the shell runs it in `SkinProvider`, components read it via `useSkinData<T>()`. **An optional escape hatch that NOTHING currently uses.** Derive that, do not trust a list: `grep -rn "useData" src/skins/*/skin.tsx` returns only comments recording the omission, and `ls src/skins/*/data/use-data.ts` returns nothing at all. It was the mechanism the two in-memory skins used; both migrated onto REST ledgers, so `useSkinData<T>()` now returns `undefined` in every skin. Each reads its own ledger through its own context/hook instead — banking `useCreditCards` + `useAuthContext`, logistics `useLogistics()`, people `usePeopleLedger()`, commerce `useCommerceLedger()`, airline `useAirlineLedger()`, keel `useKeelLedger()` + `useKeelDesk()`. The shell still runs the hook when a skin supplies one, so the field is live rather than vestigial — but the only reference for writing one is now templates.md § `data/use-data.ts`, since no shipped skin is one. |

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

- **Every registered skin now contributes one, and every one uses it for durable
  memory.** Derive that rather than trusting this sentence — `ls
src/skins/*/intelligence/user-id.ts` and `ls
src/skins/*/intelligence/seed-memories.ts` return the same set. The fallback path
  in the route is therefore unreachable from the registry today and is kept for
  skins that do not exist yet.
- **Per-user scoping is real plumbing and mostly NOT a demoable contrast.** Read
  the skin's own `intelligence/user-id.ts` before claiming anything about it on
  stage; each one's header is the authority. The recurring measured fact, written
  down in banking's, people's, commerce's, logistics', keel's and airline's alike:
  the client's `properties` frequently do not reach `identifyUser` on a run, so
  both personas land in the same default bucket and switching operator in the
  sidebar re-scopes NOTHING. That is exactly why each `seed-memories.ts` seeds the
  mapped identity's bucket **and** the default one. `airline` is a second special
  case for a different reason: one account holder, no switcher, so its resolver was
  never a "switch user and watch memory change" story at all.
- Every skin that claims the memory beats additionally ships
  `intelligence/seed-memories.ts` and `intelligence/forget-memories.ts`, which its
  `dev/reset` route uses to wipe learned memories and re-seed the ones the demo
  must start out already knowing. That pair is what makes the long-term-memory
  and stored-procedure-replay beats work; it is not emergent behaviour. Derive
  the set rather than trusting a list: `ls
src/skins/*/intelligence/seed-memories.ts`, and pair it with `ls -d
src/app/api/*/v1/dev/reset` for the reset routes. Those two used to name
  different sets; they now name the same one. Keep checking BOTH anyway, because a
  reset route without a seed file restores its data store only and cannot restore
  the memory beats — a silent trap, since its Reset button looks identical.
- **Scope a learned procedure `user`, not `project`** — and the two halves have to
  agree. Project scope is GLOBAL to the shared Intelligence instance (one backend,
  every skin), so a sweep that deletes project rows deletes a sibling skin's seeds.
  Every skin bar banking therefore has a `forget-memories.ts` that SKIPS them
  (`grep -ln 'scope !== "project"' src/skins/*/intelligence/forget-memories.ts`),
  and in such a skin a project-scoped memory **survives every presenter reset** —
  save beat 6's procedure there and the second run of the day opens already-taught:
  the agent never declines, never offers to record, and the beat proves nothing
  while looking perfect. Banking is self-consistent the other way (project scope +
  a sweep that deletes everything) and is the historical exception, not the
  pattern; every skin written since scopes `user`
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
  renders nothing for that kind; every shipped skin has one, so that branch is
  currently unexercised.

Gen-UI components registered via `useComponent` (airline's flight card, banking's
charts and queues) render in the chat transcript, not on the canvas — that is a
separate path from the full-region canvas surfaces above.

## The six skins (why they differ)

Six products behind one contract is the architectural demonstration; the fact
that `airline` and `keel` changed substrate underneath it without the shell moving
is the proof that the contract, not the substrate, is what holds. All six are now
REST-backed and all six are demo-complete, so what differs between them is
DOMAIN and which piece of the contract each one is the cleanest worked example
of — not tier. The beat matrix at the end of this section is the check.

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
  and the teach-mode loop (`docs/teach-mode/`) — and it is the only one where
  "first" is still worth knowing, because **every registered skin now has all
  four**. Which skins have which is derivable, so derive it rather than trusting a
  sentence:
  `grep -rln useAgentContext src/skins/*/layout.tsx` (route readable),
  `ls src/skins/*/intelligence/seed-memories.ts` (seeded memories), and
  `grep -l offerWorkflowRecording src/skins/*/tools.tsx` (teach mode).
- **`logistics`** ("Meridian") — **REST-backed**. A freight control tower for
  exception triage (expedite / reroute / split / absorb) across pages
  `control-tower` (index), `lanes`, `inventory`, `decisions`. Like banking it
  **omits `useData`**, reading its ledger via `useLogistics()` and the planner via
  `usePlannerAuth()`. Sets `RuntimeProviders`, `useRuntimeProperties`,
  `Providers` (the OGUI sandbox sync plus, since beat 6, the shell's teach-mode
  `RecordingProvider`), `CanvasSurface` (fed by the server tool `renderBrief`),
  `sandboxFunctions`, `toolLabels`, `chatHeaderActions` + `onSuggestionSelect`
  (both added by beat 3d, to stage the carrier rate sheet into the composer) and
  a server `identifyUser`. **The debugged reference for skin layout chrome** —
  the `h-full overflow-hidden` root and the meta-utility strip were fixed here
  first. Its teachable gate is committing a mitigation **over the planner's
  approval authority** (403 `OVER_AUTHORITY`), unlocked by an escalation filed
  under a justifying code; two over-authority shipments are seeded so the case
  taught on stage and the unaided replay are different freight, and
  `data/blocked-by-authority.test.ts` fails if that ever drops to one. The one place its
  withheld code vocabulary legitimately appears is the planner filing form,
  `components/escalation-form.tsx`.
- **`airline`** ("Aeronova") — **REST-backed**, and deliberately the one
  PASSENGER-FACING skin: a traveller's own concierge, not an agent console. Pages
  `""` (Trip), `account`, `rebook`, `loyalty`, `disruptions`, over
  `/api/airline/v1/*` (one `ledger` snapshot read plus the write paths, a bundled
  hotel confirmation, and a gated `dev/reset`). It used to be the in-memory
  reference — `useData: useAirlineData` held Camila's bookings in `useState` — and
  `data/use-data.ts` is gone: components read `useAirlineLedger()` (projected onto
  the check-in shapes by `components/concierge-view.ts`). Sets `Providers`,
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
  `onSuggestionSelect` and a server `identifyUser`. Its `useData: useKeelData` is
  gone with `data/use-data.ts`: runs and the policy register are now ONE ledger
  read through `useKeelLedger()` / `useKeelDesk()`, and — the load-bearing half of
  that migration — **elapsed run time is settled SERVER-SIDE on every read**
  (`src/app/api/keel/v1/settle-runs.ts`, called by both `GET /ledger` and `GET
/runs/[runId]`), so the client interval only re-reads. The deleted 900 ms
  `setInterval` was a second clock that painted progress the server had never heard
  of. **Still the only skin with parameterized routes** — `resolvePage` is
  Map-based and resolves `knowledge/<docId>` → `DocumentPage` and `runs/<runId>` →
  `RunDetailPage` alongside its static segments. Its gate is who may **RELEASE** a
  policy revision (403 `UNENDORSED_REVISION`), unlocked by a publication variance
  filed under a justifying code; note beat 3a's PIN countersign and beat 6's gate
  touch the SAME write, which is the collision failure-modes.md § 12 warns about,
  so the countersign route re-runs the release gate. Its beat map is
  `src/skins/keel/data/beat-map.md`; its pill-to-beat table is at the top of
  `src/skins/keel/suggestions.ts`.

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

### Demo-beat coverage

| Beat                             | banking              | people               | commerce             | airline                | logistics            | keel                   |
| -------------------------------- | -------------------- | -------------------- | -------------------- | ---------------------- | -------------------- | ---------------------- |
| Gen-UI in transcript             | ✅                   | ✅                   | ✅                   | ✅                     | ✅                   | ✅                     |
| Rich thread survives reload      | ✅ replay-safe tools | ✅ replay-safe tools | ✅ replay-safe tools | ✅ replay-safe tools   | ✅ replay-safe tools | ✅ replay-safe tools   |
| Drive the app, secret withheld   | ✅ card PIN          | ✅                   | ✅                   | ✅ card on file        | ✅ planner PIN       | ✅ countersign PIN     |
| "What's on my screen?"           | ✅ route + page      | ✅ route + page      | ✅ route + page      | ✅ route + page        | ✅ route + page      | ✅ route + page        |
| Navigate via levers + filters    | ✅                   | ✅                   | ✅ four levers       | ✅ four levers         | ✅ four levers       | ✅                     |
| Multimodal → durable artifact    | ✅ Q2 invoice        | ✅ offer letter      | ✅ price sheet       | ✅ hotel confirmation  | ✅ rate sheet        | ✅ regulatory bulletin |
| Long-term memory recall          | ✅                   | ✅                   | ✅                   | ✅                     | ✅                   | ✅                     |
| Stored-procedure replay          | ✅                   | ✅                   | ✅                   | ✅                     | ✅                   | ✅                     |
| Teach a new procedure            | ✅ over-limit        | ✅ out-of-band       | ✅ below-floor       | ✅ fare not changeable | ✅ over-authority    | ✅ unendorsed revision |
| Presenter reset (route + button) | ✅                   | ✅                   | ✅                   | ✅                     | ✅                   | ✅                     |

**Every registered skin hits every row.** That is a recent state of affairs and
the table is the WORST place to learn it from: a matrix of ticks is prose, it rots
silently, and this one spent two releases showing ❌ against beats `logistics` had
already shipped and then did the same to `airline` and `keel`. So run the checks
instead — each is one command, and each returns every registered skin today, which
is what makes a MISSING entry the signal:

```bash
grep -rln useAgentContext src/skins/*/layout.tsx     # beat 3b, the route readable
grep -rln useAgentContext src/skins/*/pages/         # beat 3b, the on-screen ones
ls src/skins/*/intelligence/seed-memories.ts         # beats 4 and 5, seeded
ls src/skins/*/intelligence/forget-memories.ts       # + the reset's memory half
grep -l offerWorkflowRecording src/skins/*/tools.tsx # beat 6, the teach loop
ls -d src/app/api/*/v1/dev/reset                     # the presenter-reset route
grep -rln usePresenterReset src/skins/               # …and its button
```

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
are not in the table: the pill spread runs 8 to 12 and the gen-UI spread 4 to 9
across skins that all hit every row. `commerce` ties for the FEWEST gen-UI
registrations in the tree and is still one of the cleanest demo references in it;
`keel` ships the most pills of any skin for a reason that has nothing to do with
beats (four identity pills predating the bar, kept verbatim — the header of its
`suggestions.ts` shows the arithmetic).

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

- **`pnpm exec tsc --noEmit` — the only full type-check in the tree. Run it.**
  There is no `typecheck` script, and the sentence this bullet replaces claimed
  `pnpm build` covers it. It does not: `next build` type-checks only what the
  app's **module graph reaches**, so it never visits the test files (`find src e2e
-name '*.test.ts*' | wc -l`), and
  Vitest transpiles without type-checking at all. `tsconfig.json` DOES include
  `**/*.tsx`, so those files are in the project and simply nothing was checking
  them — a real `TS2352` sat in a slot that had already reported three green
  gates. Treat the four gates as `pnpm lint` · `pnpm exec tsc --noEmit` ·
  `pnpm test:unit` · `pnpm build`, in that order (cheapest first).
- `pnpm dev` — run the app (needs `OPENAI_API_KEY`; copy `.env` from
  `.env.example`). Visit `/`, which redirects to the default skin.
- `pnpm build` — production build. It type-checks the app's own module graph, so
  it catches a broken page or tool; it is NOT the type-check gate for tests.
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
  implementations, any of which is a demo-completeness reference. Open them for
  what each is the CLEANEST example of: `banking` the original reference and the
  richest gen-UI set, `people` and `commerce` beat-first authoring with the beat map
  written out in `suggestions.ts`, `commerce` also a four-lever navigation,
  `logistics` layout chrome and the server-emitted a2ui canvas, `airline`
  runtime identity WITHOUT `RuntimeProviders` plus an entitlement-shaped (rather
  than authority-shaped) beat-6 gate, `keel` parameterized routes and a
  server-settled clock.
- `.claude/skills/reskin/` — the authoring skill: `SKILL.md` (contract + wiring
  traps), `demo-beats.md` (what the demo must prove, and the quality bar),
  `templates.md` (per-file starting points), `failure-modes.md` (how a skin lies —
  read it before writing tools or pages).
- `docs/DESIGN.md` — the banking skin's visual design system ("Aurora").
- `docs/teach-mode/` — the banking skin's teachable over-limit-approval flow, plus
  `verify-teachable-gate.sh` which proves the gate → unlock path over pure REST.
- `docs/superpowers/` — plans and specs for this app's own development.
