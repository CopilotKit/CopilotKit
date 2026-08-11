---
name: reskin
description: >-
  Author a NEW skin for the reskinnable-demo app. A skin is a self-contained
  domain plugin under src/skins/<id>/ that implements the frozen `Skin` contract
  (src/shell/skin-contract.ts) to swap the app's entire experience — brand,
  theme, layout, pages, tools, data, and agent — as a live sales demo. Use when
  the user says "add a skin", "create a skin", "new skin", "reskin the app",
  "make a <domain> skin", or wants the app re-themed as a new product. Do NOT
  use for editing the shell itself (src/shell/**), the shared token vocabulary
  (src/app/globals.css), or the six shipped skins unless explicitly asked.
---

# Authoring a reskinnable-demo skin

This app hosts one skin-agnostic **shell** (`src/shell/`) that renders one
**skin** per URL segment `/[skin]/...`. A skin is a domain plugin living entirely
under `src/skins/<id>/`. Its ONLY inbound dependency is the frozen `Skin`
contract in `src/shell/skin-contract.ts` — that is what lets skins be authored
in isolation without touching shared code.

To add a skin you (1) map the demo beats it must hit, (2) implement the `Skin`
contract in `src/skins/<id>/`, (3) put its **server-only** agent in
`src/skins/<id>/agent.ts`, and (4) register both — the client skin in
`src/shell/registry.ts` and the agent in `src/shell/agent-registry.ts`, keyed by
the identical `id`.

> Before writing anything, re-open `src/shell/skin-contract.ts` (the source of
> truth) and read the shipped skins as worked references. Six are registered —
> `banking`, `airline`, `logistics`, `keel`, `people`, `commerce` — and they are
> good at different things; **[demo-beats.md](./demo-beats.md) § "Which skin to
> copy for what"** is the routing table. The short version: `banking`, `people`
> and `commerce` are the three demo-complete skins (`banking` is the original
> reference; `people` and `commerce` are the newer ones, and the only two whose
> beat maps are written out in their `suggestions.ts`), `logistics` is the
> debugged layout reference, `airline` is the minimal contract surface, `keel` is
> the only one with parameterized routes. Those files win on any conflict with
> this skill.

---

## ⚠️ FIRST: a skin is a live sales demo, not a theme

A skin exists to prove CopilotKit and Intelligence top to bottom, in front of a
Fortune 500 buyer. Wiring the contract correctly is table stakes; a skin that
compiles, looks sharp and proves nothing is a **failed skin**. The banking demo's
~10 steps are tuned and land with customers — so copy its **beats**, not its
steps. Your domain can be 1000% different.

| Beat                  | The audience must conclude                                                           | Minimum mechanism                                                          |
| --------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **1** Give it a face  | "Generative UI — right out of the gate."                                             | A `useComponent` visual answers pill #1                                    |
| **2** Rich thread     | "Reload the browser and the chart is still there. Nobody else stores AG-UI streams." | Durable visuals via `useComponent`; **replay-safe** tools                  |
| **3a** Drive the app  | "It changed the app — and the secret never reached the assistant."                   | A mutation whose sensitive payload stays in the UI                         |
| **3b** Sees my screen | "Shared state is real." (ask on two different pages)                                 | A **route readable** + per-page on-screen readables                        |
| **3c** Levers         | "That was a maneuver, not a link."                                                   | HITL confirm → navigate → sort **+** filter, visibly highlighted           |
| **3d** Multimodal     | "It takes real documents, and the output belongs to my app."                         | Attachment path + artifact written to the store, surviving thread deletion |
| **4** Memory          | "It remembers how I like things, and says so."                                       | Seeded topical memory + recall-first prompt + a slot naming the "why"      |
| **5** Stored skill    | "One sentence and it already knows our procedure."                                   | Seeded operational memory + 3 visible writes + distractors                 |
| **6** Teach a skill   | "It learned by watching me once, then did it alone."                                 | Symptom-only gate + unlock path + recording context + save/recall          |

**Write the beat map before you write code** — the table template and the full
per-beat spec are in **[demo-beats.md](./demo-beats.md)**, which also covers the
presentation requirements (a pill per beat so the presenter never types, a visible
affordance on every mutation, pretty markdown prose, a Reset control, the
chat-placement framing) and the quality bar.

**If the user named the beats** — fewer, more, or different — theirs win. Record
what they asked for in the beat map and build that. Absent instructions, build
all nine.

**Then read [failure-modes.md](./failure-modes.md), before you write tools or
pages.** It is the cross-cutting half of this skill, and its through-line is the
one thing to carry into every file: **a skin's characteristic bug is not a crash —
it is a confident falsehood.** A crash is visible on stage and gets fixed; a
convincing lie reads as success and proves nothing. An empty chart drawn with
confidence, a lever chip naming a choice the agent never made, a receipt for a
write that did not land, a readable reporting an all-clear it never checked — all
of those compile, lint, pass tests, and land as a successful demo. That file states
the principles and points at the shipped `commerce` code for each; the per-file
scaffolds stay in [templates.md](./templates.md).

⚠️ Beats **2, 4, 5 and 6 are runtime-conditional**: they need all three
`INTELLIGENCE_*` env vars, and beats 4/5 additionally need a seeded-memory file
(`src/skins/<id>/intelligence/seed-memories.ts`). Without those they degrade
**silently** — the agent simply doesn't know you. See demo-beats.md.

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

**A `sandboxFunction`'s `parameters` schema is DOCUMENTATION, not a gate — and its
returns are undocumented unless the `description` says so.** Two traps, both of
which produce a generated panel that renders and is wrong:

- The provider serializes `parameters` into agent context and the renderer then
  hands your bare `handler` to the iframe (`api[fn.name] = fn.handler`). Nothing
  validates the arguments, so a loose parameter (`category: z.string()`) filters
  on a value nothing matches and returns `[]` — a convincingly blank view, with
  the model never told it guessed wrong. Enumerate every parameter to its real
  domain (`z.enum(YOUR_CONST_TUPLE)`, so the vocabulary reaches the model too) and
  parse the args in the handler, throwing a message that names the accepted
  values. Commerce's `define()` wrapper in `src/skins/commerce/sandbox-functions.ts`
  is the worked example. **One exception, and it is load-bearing: a beat-6 gate's
  unlock vocabulary must NOT be enumerated** — putting those codes in front of the
  model is exactly the defect, because then it never has to learn them. Take a free
  `z.string()` there and say so in the `.describe()`. See failure-modes.md § 10.
- The model never sees a sample result — only `name`, `description` and the
  JSON-schema-ified `parameters`. So a figure whose unit is not in its FIELD NAME
  must have it in the `description`: an unlabelled ratio (`0.418`) renders as
  "0.42%" or "41.8%" with equal confidence. Commerce ships ratios as
  `…Ratio` + a `…Label` string built with the app's own formatter, which also makes
  the generated panel read identically to the app card beside it.

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

| Field                   | Type                                                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Providers?`            | `ComponentType<{ children: ReactNode }>`             | Skin-specific provider stack mounted **below** `CopilotKitProvider` (escape hatch). Omit → shell substitutes a pass-through.                                                                                                                                                                                                                                                                                                                                                                                |
| `CanvasSurface?`        | `ComponentType`                                      | Renders the skin's own a2ui report surface full-region on the shared canvas. Omit if no a2ui report canvas.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `sandboxFunctions?`     | `SandboxFunction[]`                                  | Functions exposed inside OGUI sandboxed iframes for this skin.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `toolLabels?`           | `Record<string, string>`                             | Human labels for this skin's OWN tool-activity chips, keyed by tool name. Unlisted tools fall back to a prettified raw name.                                                                                                                                                                                                                                                                                                                                                                                |
| `chatHeaderActions?`    | `ChatHeaderAction[]`                                 | Buttons this skin contributes to the shared chat header (drawn before the shell's own controls).                                                                                                                                                                                                                                                                                                                                                                                                            |
| `onSuggestionSelect?`   | `(suggestion: Suggestion, index: number) => boolean` | Intercept a suggestion click. Return `true` if fully handled (shell does nothing further); return `false`/omit for the default "send the message" path. `true` is a PROMISE that something happened — the handler it launches must either do the thing or tell the presenter why it could not (see beat 3d in demo-beats.md); `true` plus silence is the bug this contract keeps producing.                                                                                                                 |
| `RuntimeProviders?`     | `ComponentType<{ children: ReactNode }>`             | Provider stack mounted **above** `CopilotKitProvider` (unlike `Providers`, below). The sanctioned place to establish context your `useRuntimeProperties` must read — it has to sit above the provider so the provider owns `properties` from its first commit. See "Contributing end-user identity" below.                                                                                                                                                                                                  |
| `useRuntimeProperties?` | `() => Record<string, unknown> \| undefined`         | Contributes this skin's runtime `properties`; the shell threads the result into `CopilotKitProvider`'s `properties` prop. How a skin scopes its Intelligence runs / durable memory per end-user. Return a stable/memoized object. Omit if the skin contributes no runtime identity.                                                                                                                                                                                                                         |
| `useData?`              | `() => unknown`                                      | Seed-backed data hook; the shell runs it in `SkinProvider`, components read via `useSkinData<T>()`. **The standard mechanism for the two in-memory skins, deliberately unused by the four REST-backed ones** — it splits along the substrate line: `airline` (`useAirlineData`) and `keel` (`useKeelData`) each supply a real one; banking, logistics, people and commerce all omit it and read their REST ledger through their own context/hooks, so in those four `useSkinData<T>()` returns `undefined`. |

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

One thing every shipped `Layout` gets right and the naive version gets wrong —
fixed once in `src/skins/logistics/layout.tsx`, which the template mirrors:

- **The root is `h-full overflow-hidden`, NOT `h-screen` or `min-h-screen`.** Your
  chrome fills the shell's app CARD, not the viewport — the frame insets that card
  by its own padding, so a viewport-height root overflows it by exactly that much.
  It still has to be BOUNDED, though: if the container can grow past the card the
  whole document scrolls, the pinned nav scrolls away with it, and `<main>`'s own
  `overflow-y-auto` goes inert because its parent is unbounded. `h-full
overflow-hidden` on the root, plus `h-full` on the `<aside>`, so only `<main>`
  scrolls.

> **Retired:** older skins published `--nw-nav-inset-left` / `--nw-nav-inset-right`
> from a `useEffect` so the shell's floating skin selector could dodge their nav.
> Both the variables and that selector are gone — the switcher is now a dropdown in
> a card at the top of the assistant column, so it occupies a slot and never
> overlaps anything. Do not add those publishers to a new skin; nothing reads them.

## The URL contract (never hardcode the skin prefix)

**Every in-skin link and `router.push` must go through `useSkinHref`**
(`src/shell/skin-path.ts`), and every "which nav entry is active" derivation
through its companion `useSkinSegments`. Both are in the layout template.

Skins live under `/[skin]` on the normal demo (one segment per registered skin),
but a `LOCK_SKIN` deploy is served **at `/`** with the segment gone from the URL
space entirely — `src/proxy.ts` rewrites the prefix-free space onto the route
tree. So:

- `skinHref("cards")` → `/banking/cards` unlocked, `/cards` locked.
- A hardcoded `` `/${skin.id}/cards` `` still RESOLVES under a lock, which is why
  this is easy to miss: it just puts `/banking` back in the address bar on the
  first nav click, and the single-tenant illusion is gone.
- A hand-rolled `pathname.split("/").slice(2)` is worse — it silently eats the
  first real segment when there is no prefix to skip, so under a lock every page
  reports itself as the index and the wrong nav entry highlights.

Deep links append their own hash:
`` `${skinHref(`knowledge/${docId}`)}#${sectionId}` ``. A skin with many
parameterized links should wrap the hook once for itself — see
`src/skins/keel/href.ts`, which exists so keel's id appears in exactly one place
instead of the eleven string literals it had before.

The one legitimate exception is a link to a DIFFERENT skin (the shell's skin
switcher), which must keep the prefix and only ever renders unlocked.

**`pnpm lint` enforces this** via `no-restricted-syntax` selectors in
`eslint.config.mjs` (scoped to `src/skins/**`, tests exempt). They fail and NAME
YOUR FILE if an in-skin path literal (i) opens with a skin id segment
(`"/banking/cards"`, `` `/keel/runs/${id}` ``), (ii) concatenates a path onto an
interpolated base (`` `${base}/charges` `` — the `//` shape) **when that template is
a navigation target**, or (iii) opens with a leading-slash interpolation
(`` `/${skin.id}/…` ``). The rule reads the AST, so a skin prefix inside a comment or
prose string is fine and a `$` in a variable name cannot fool it.

Selector (ii) is deliberately narrowed to navigation contexts: the `` `${x}/${y}` ``
shape is AST-identical to an ordinary date `` `${month}/${day}` `` or ratio
`` `${used}/${total} used` ``, so flagging it everywhere false-positives on any skin
component that formats a date or fraction. It therefore fires only when the template
is passed to `router.push`/`router.replace`, to `location.assign`, assigned to
`location.href`, or set as a JSX `href={...}`. Trade-off, stated honestly: a URL
built into a variable first and then navigated (`const u = `${base}/x`;
router.push(u)`) is NOT caught by (ii) — the literal-prefix guards (i)/(iii) still
catch the common hardcoding shapes regardless of use site. Because (ii) is now
nav-scoped, REST/data-layer files (`actions.ts`, `intelligence/**`) that build
absolute SERVER urls (`` `${BASE}/shipments` ``) never trip it anyway; they stay
explicitly scoped out as belt-and-suspenders.

## The meta-utility strip

The presenter/dev utilities — Reset, theme toggle, Help — are **skin-authored
chrome, not shell-provided**. A new skin gets none of them for free; you add them
in the layout (the template puts them in an `mt-auto` group at the bottom of the
sidebar). Three controls:

- **Reset** (`RotateCcw`) — render it only when `usePresenterReset()` (from
  `@/shell/presenter-reset-context`) is true; on click, `window.confirm` then
  `POST /api/<id>/v1/dev/reset` then `window.location.assign(skinHref())` for a
  pristine slate. **Branch on what the route says about the STORE, not on
  `res.ok`** — the route wipes the store first and can still answer non-2xx, so an
  ok-only branch leaves the page (and the readables describing it) asserting rows
  that are gone, and throws away the body's `memoryError` sentence, which is the
  only warning that beat 6 may start out already taught. See the scaffold in
  templates.md and `runPresenterReset` in `src/skins/commerce/layout.tsx`.
  This one deliberately IS a full document load rather than a
  `router.push` — dropping every module reload-fresh is the point (new store, new
  thread, cleared canvas) — but the URL it navigates to is still built by
  `useSkinHref`, exactly as in the layout template. Do **not** hand-roll it as
  `` `/${skin.id}` ``: that is shape (iii) from the URL contract above, so it fails
  `pnpm lint`, and on a locked deploy it re-introduces the tenant segment the
  reset is supposed to leave behind (`skinHref()` returns `/` there). Keep the
  button and the endpoint in agreement: your skin's own
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

## Registering tools: deps, render signatures, replay safety, readables

Five rules that the `tools.tsx` template bakes in; miss any and the failure is
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
- **A gen-UI render's `parameters` schema is NOT enforced either, and a render-only
  tool has no way to report a bad argument back.** Same trap as a
  `sandboxFunction`'s schema (above), one degree worse. A `useComponent` render is
  handed `partialJSONParse(toolCall.function.arguments)` verbatim
  (`use-render-tool-call.tsx` in `@copilotkit/react-core`); the schema is only
  serialized into the tool definition the model reads. And because a
  render-only tool has no `handler`, core posts an EMPTY tool result
  (`executeSpecificTool` in `run-handler.ts`), so there is no string to correct the
  model with — the sandbox's "throw a message naming the accepted values" escape
  hatch does not exist here. So do BOTH: enumerate the parameter to its real
  domain (`z.enum(YOUR_CONST_TUPLE)`, which is what puts the vocabulary in front of
  the model), AND resolve it explicitly in the render, drawing a plain "there is no
  such X, the real ones are …" card instead of the visual. Commerce's
  `showMarginLadder` + `src/skins/commerce/category-argument.ts` is the worked
  example: a `z.string()` category meant "Shoes" for "Footwear" drew the signature
  five-rail ladder with ZERO dots on it — an empty view that renders confidently is
  the worst outcome available, because it looks like an answer. Note the third
  state that module carries: arguments STREAM, so a value that is still a PREFIX of
  a real member is "not arrived yet", not a refusal — refuse it and you flash a red
  card on every call the demo makes. (Same beat-6 carve-out as above: a GATE's
  unlock codes are the one closed set you must leave un-enumerated —
  failure-modes.md § 10.)
- **EVERY argument is `undefined` mid-render, including the ones your schema
  declares REQUIRED.** The point above is about a value that arrived and was
  wrong; this one is about a value that has not arrived at all. A render runs from
  the first frame of its tool call, and `partialJSONParse` returns `{}` for those
  frames, so `.optional()` is not what makes a field absent and a required field
  is not what makes it present. Two different bugs come out of that and one guard
  fixes only one of them:
  - it **THROWS**: `orderIds.map(…)` / `list.length` / `id.replace(…)` on an
    argument that is still `undefined` is a TypeError **inside React render**.
    Guard the shape — banking's `showTable` is the reference (`columns ?? []`,
    `rows ?? []`, `src/skins/banking/tools.tsx:793-794`) — and remember the
    CONTENTS too: a half-streamed `["` parses to `[""]`.
  - it **LIES**: formatting an absent value into a confident label asserts a
    choice nobody made. `showOrderQueue`'s Sort chip printed "Sort · oldest first"
    over an unset lever (see `src/skins/commerce/order-queue-levers.ts`);
    `showProduct` flashed a red "nothing matches ''" before its needle arrived;
    `showMarginSummary` drew beat 4's rose "why" band as an empty coloured bar
    while the note streamed. The fix is never a default — it is to render only
    what is known.

  And do not over-guard into silence: a card that returns nothing while arguments
  stream is worse television than a placeholder, because beat 1 leads with
  generative UI and the room is watching it appear. Commerce's `ArrivingCard` +
  `arrivedText` in `src/skins/commerce/tools.tsx` are the worked example —
  one muted card that names only what has arrived, and the confident branch
  (a miss, a receipt, a label) reserved for arguments that actually landed.

- **Renders must be REPLAY-SAFE: key them off the tool `result`, NOT off
  `status`.** Reopening a thread (or reloading the browser in Intelligence mode)
  replays recorded tool calls, so you get the stored **result** and no live status
  transition. A render keyed on `status` looks perfect during the demo and then
  renders blank or wrong the moment anyone revisits the thread — which is exactly
  when beat 2 ("reload and the chart is still there") is being shown. Re-derive
  display state from the replayed result, and never depend on client state that
  only existed during the live call. Banking, people, commerce and logistics are
  written this way; banking's is the canonical example:
  `setCardPin` re-derives its card from the replayed result plus a module map
  holding only `brand`/`last4` — never the PIN (`tools.tsx:70-89`, `418-451`) —
  and `showCharges` keys off `result` not `status` (`tools.tsx:553-572`).
  **This is lint-enforced, per skin.** The `statusKeyedTerminalRender` selector in
  `eslint.config.mjs` fails any `status === ToolCallStatus.Complete` — but only
  inside the `files` glob of skins already re-keyed (logistics today; keel and
  airline still carry the defect and widen it in their own phases). Add your
  skin's `.tsx` to that glob, **restating every selector the block already
  resolves to** (see "flat-config `rules` are REPLACED, not merged" in the
  verification list below), and add a row for your files to the resolved-selector
  table in `src/shell/skins-config.test.ts`. `status === ToolCallStatus.Executing`
  on an INTERACTIVE branch is correct and deliberately not matched — an executing
  HITL card only ever exists live.
- **Register a ROUTE readable and per-page on-screen readables**, not just global
  ones. `useAgentContext({ description: "The current page…", value: <segment> })`
  in your layout tells the agent which page is open; readables registered inside
  each _page_ component tell it what is visibly on screen (active filters, the
  rows actually rendered, the figures shown). Without both, "what's on my
  screen?" (beat 3b) returns the same answer on every page and the beat dies.
  Banking, people and commerce are the only skins that do this. Banking: route
  readable at
  `layout.tsx:141-143`, page-scoped readables in `dashboard.tsx:148`,
  `cards.tsx:376`, `team.tsx:54`, and the richest in `charges.tsx:139`. People
  does the same across all four of its pages, and is the tighter read if you want
  one worked example — the route readable maps the index segment to a real page
  NAME (`layout.tsx`'s `ROUTE_READABLE_NAME`) rather than reporting `""`. Pair
  them either way with a prompt clause telling the agent its context IS its view
  of the screen and that it must never claim it cannot see (`agent.ts:61-71`).

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
├── suggestions.ts    # Suggestion[] — ONE PILL PER BEAT, in demo order
├── design-skill.ts   # the OGUI design-brief string
├── data/             # OPTIONAL: seed data + use-data hook (useXData) → useData
├── intelligence/     # OPTIONAL: user-id.ts (identifyUser) + seed-memories.ts (beats 4/5)
└── agent.ts          # SERVER-ONLY: export const <id>Agent = () => new BuiltInAgent(...)
```

Optional slots you may omit — airline omits all of these EXCEPT `toolLabels` and
`useData`: `providers.tsx` (→ `Providers` and/or `RuntimeProviders` +
`useRuntimeProperties`), `intelligence/user-id.ts` (→ server `identifyUser`),
`canvas-surface.tsx` (→ `CanvasSurface`), `sandboxFunctions`,
`chatHeaderActions`, `onSuggestionSelect`.

`useData` / `data/` is where the substrates split, and it is a 4-2 split rather
than a banking-vs-airline one: **banking, logistics, people and commerce** are
REST-backed and OMIT `useData` (their components read the ledger directly, so
`useSkinData<T>()` returns `undefined`); **airline and keel** are in-memory and
SET it (`useAirlineData`, `useKeelData`).

Airline DOES set `toolLabels` (a 9-entry map) so its tool-activity chips read as
human phrases ("Pulling up your flight") instead of raw tool names (`showFlight`)
— treat `toolLabels` as expected for any skin with named frontend tools, not
optional in practice. `RuntimeProviders`/`useRuntimeProperties`/`identifyUser`
are for a skin with its own end-user identity (see the identity section above);
banking, logistics, keel, people and commerce all five ship them, airline none.

`intelligence/seed-memories.ts` is **not** optional if you are building beats 4
and 5 — "it already knows me" is a seeded file, not emergent behaviour, so every
demo-complete skin ships one (`banking`, `commerce` and `people`, each alongside a
sibling `forget-memories.ts` its `dev/reset` route calls first); a skin claiming
those beats without one is claiming behaviour it does not have. It seeds the
topical preference (beat 4) and the operational
procedure (beat 5), and deliberately does NOT seed beat 6's procedure — that is
the one the agent has to learn on stage. See
**[demo-beats.md](./demo-beats.md) § "Seeding memories"**.

Templates for each file are in **[templates.md](./templates.md)** — copy them and
fill in your domain. They are written against this app's real contract.

---

## Authoring order (slot by slot)

**Step 0 — the beat map, before any code.** Fill in the nine-row table from
[demo-beats.md](./demo-beats.md): for each beat, this skin's step, its pill, and
what implements it. This is what stops you from building a technically perfect
skin that proves nothing — the documented failure mode is an author who wires the
contract beautifully and silently drops beats 2, 3b, 5 and 6. Decide the demo,
then build it.

Then build in dependency order so each slot compiles before the next depends on it:

1. **identity** (`identity.ts`) — brand, tagline, logo.
2. **theme** (`theme.css`) — `.theme-<id>` token values.
3. **data** (`data/`, OPTIONAL) — seed + `useXData()` hook (feeds pages, tools, and the agent's context). Skip if the skin has no shell-managed data (then omit `useData`). Seed **two** of anything beat 6 gates, so the replay lands on a fresh one.
4. **layout** (`layout.tsx`) — chrome; side-effect-import `./theme.css` here; the route readable (beat 3b) and the meta-utility strip live here.
5. **pages** (`pages/`) — one component per nav segment, each registering its own on-screen readable (beat 3b).
6. **tools** (`tools.tsx`) — frontend tools / HITL / gen-UI + `useAgentContext` readables. Replay-safe renders (beat 2), visible affordances on every mutation.
7. **catalog** (`catalog/`) — a2ui catalog via `createCatalog`.
8. **agent** (`agent.ts`) — server-only `BuiltInAgent` factory. This is where the beats are _enforced_: screen-awareness, recall-first, procedure separation, "never write a markdown table", pretty bold prose.
9. **intelligence** (`intelligence/`, for beats 4–6) — `user-id.ts` + `seed-memories.ts`.
10. **suggestions** (`suggestions.ts`) — one pill per beat, in demo order — plus **design-skill** (`design-skill.ts`).
11. **register** — `skin.tsx` assembles the object; then wire both registries.

Run `pnpm build` after wiring things up — `next build` type-checks the whole app
(there is no separate `typecheck` script). `pnpm lint` catches the rest.

---

## Registration (the only shared-file touch)

Five appends. The first two are keyed by the identical `id`; the third teaches the
lint guard that your id exists; the last two are the hand-copied config in
`src/shell/skins-config.ts` that server components read. All five are REQUIRED.

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

⚠️ **This is the one append with NO automated guard.** No test imports
`agent-registry.ts` (`grep -rln agentRegistry src --include='*.test.*'` is empty),
and its `Record<string, AgentRegistration>` type accepts a missing key, so
forgetting it builds, lints and renders — the only symptom is Verification step 5:
sending a chat message errors with an unknown agent. Appends 3–5 below are all
compared against `registry.ts` by `skins-config.test.ts`; this one is on you.

**3. Lint guard id list** — append your id to `LINTED_SKIN_IDS` in
`eslint.config.mjs`. This is REQUIRED, not optional: that array is what the
URL-contract selectors interpolate into their regexes, so until your id is in it
`pnpm lint` is BLIND to your skin and a hardcoded `"/support/tickets"` href passes
clean while breaking the address bar under a lock. It is a hand-copy of `skinIds`
because an ESLint flat config is loaded by Node and cannot import a `.ts` module.

```ts
export const LINTED_SKIN_IDS = [
  "banking",
  "airline",
  "logistics",
  "keel",
  "people",
  "commerce",
  "support", // ← add
];
```

Forgetting this fails `pnpm test:unit` — `src/shell/skins-config.test.ts` lints a
synthetic prefixed link for every registered skin through the real selectors, so an
unguarded id is RED rather than silent. (That test exists because this list DID rot:
it named four skins for two releases after `people` and `commerce` shipped.)

**4. LOCK_SKIN id list** — append your id to `skinIds` in
`src/shell/skins-config.ts`, in registry order. That module stays import-free so
server components can read it, which forces the list to be a hand-copy of the
registry's keys — and it is the set the `LOCK_SKIN` validator accepts, so until
your id is in it `LOCK_SKIN=<id>` throws at boot and `/` cannot serve your skin:

```ts
export const skinIds = [
  "banking",
  "airline",
  "logistics",
  "keel",
  "people",
  "commerce",
  "support", // ← add
] as const;
```

**5. Locked-deploy metadata** — add an entry to `skinIdentities`, in the same
file, copying your `identity.brand` and `identity.tagline` VERBATIM. The root
layout's `generateMetadata` (`src/app/layout.tsx`) is a server component and
reads this map — not your skin module — to give a locked deploy the brand as its
`<title>` and the tagline as its `<meta name="description">`:

```ts
export const skinIdentities: Record<
  (typeof skinIds)[number],
  { brand: string; tagline: string }
> = {
  // …existing skins…
  support: { brand: "Support Desk", tagline: "Every ticket, answered." }, // ← add
};
```

Neither of those two can be forgotten quietly. A missing `skinIdentities` entry is
a `pnpm build` type error, because the `Record` key type is derived from `skinIds`;
a WRONG brand or tagline, or an id missing from `skinIds`, is caught by
`skins-config.test.ts`, which compares both against the registry.

**6. (Optional) default skin** — set `defaultSkinId` in
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
3. The skin appears in the **selector dropdown** at the top of the assistant
   column — open it from the trigger showing the active skin's brand.
4. Navigating to `/<id>` renders your `Layout` with the correct theme (your
   `.theme-<id>` token values visibly applied — accent color, canvas, etc.).
5. Sending a chat message gets a reply from **your** agent (confirms
   `id === agentId` and that the agent registered correctly).
6. Your suggestion pills appear, and if you registered frontend tools / HITL /
   gen-UI, the agent can drive them.

   > **Automating a pill click? Select by ROLE, not by text.**
   > `getByRole("button", { name: "…" })`, never `getByText("…")`. The thread rail
   > (`.nw-chat-rail`, shell-owned, so this bites every skin identically)
   > accumulates **saved thread titles**, and a thread gets titled after the
   > message its pill sent — so on the second run `getByText("Decision brief")`
   > matches the rail entry, your driver clicks a thread instead of the pill, and
   > the beat appears not to fire. It reads as a broken app rather than a wrong
   > selector, which is why it costs a walk or two before anyone suspects it.

7. **`pnpm lint`** — green. This includes the URL-contract guard: the
   `no-restricted-syntax` skin-prefix selectors in `eslint.config.mjs`, which fail
   and NAME YOUR FILE if any link in your skin hardcodes its route prefix or
   hand-concatenates onto a builder result (a leading `//`). It is the cheap check
   for the contract above; step 8 is the real one. **This only works if your id is
   in `LINTED_SKIN_IDS`** (registration step 3) — otherwise lint is green because it
   is not looking. `pnpm test:unit` must also be green; `skins-config.test.ts` is
   what catches an id missing from that list, and `skin-roster-docs.test.ts` what
   catches prose left behind — a skin count or a "valid ids" list in CLAUDE.md,
   README.md, `.env.example` or this skill that predates your skin.
8. **Run your skin locked**: stop the dev server, then
   `LOCK_SKIN=<id> pnpm dev`, and open **`/`** (not `/<id>`). Your skin must
   render at the root, every nav href in the DOM must be prefix-free, and
   clicking through must keep the address bar prefix-free. `/<id>` itself should 404. If the prefix survives anywhere, a link in your skin is bypassing
   `useSkinHref` — see "The URL contract" above.
   `pnpm test:e2e --project=locked` covers this shape for `banking`; extend
   `e2e/locked-skin.spec.ts` if your skin is the one being shipped locked.

If the skin 404s: check `resolvePage` returns a component for `[]` (the index
segment). If the theme doesn't apply: confirm `themeClass === "theme-<id>"` and
that `layout.tsx` side-effect-imports `./theme.css`. If chat errors with an
unknown agent: confirm the agent is in `agent-registry.ts` under the same `id`.
If the whole app 404s under a lock: `LOCK_SKIN` must be one of the registered
ids — an unrecognised value throws at boot naming the typo.

### Then walk the demo (this is the part that actually gates "done")

A green build proves the wiring. Only walking the beats proves the skin. Click
**every** pill in order, typing nothing, and check each beat's failure mode — all
of these compile and lint clean while failing live:

1. **Beat 1** — the first pill renders a visual, not a paragraph.
2. **Beat 2** — reload the browser, reopen the thread: the visuals are still
   there and still correct. (Needs Intelligence env vars. A render keyed on
   `status` fails _only_ here.)
3. **Beat 3a** — the mutation lands, and the sensitive value appears nowhere in
   the transcript. Earlier gen-UI is still in the thread.
4. **Beat 3b** — ask on two different pages; the answers differ and cite real
   on-screen figures. Identical answers mean no route readable.
5. **Beat 3c** — a confirm card lists the levers before navigating, and after
   navigation the applied controls are visibly highlighted.
6. **Beat 3d** — the artifact appears in the app, then delete the thread: it is
   still there.
7. **Beat 4** — the answer names the preference it recalled. If it just answers
   normally, either the seed file or the recall-first prompt clause is missing.
8. **Beat 5** — one vague sentence fires all the procedure's steps in order, no
   confirmation, each visibly. If it offers to record something, beats 5 and 6
   are bleeding into each other in the prompt.
9. **Beat 6** — it declines, records, saves; then on a **different** gated record
   it runs the procedure alone. If it clears the gate BEFORE being taught, you
   published the unlock vocabulary to it somewhere — readable, schema `z.enum`,
   tool description, prompt, or refusal body (failure-modes.md § 10). Also prove
   the gate over pure REST with no agent involved: copy
   `docs/teach-mode/verify-logistics-gate.sh` (or banking's
   `verify-teachable-gate.sh`) for your routes, and add BOTH your `tools.tsx` and
   your `agent.ts` to the `withheldGateVocabulary` rule's `files` glob in
   `eslint.config.mjs` — **restating EVERY selector those files already resolve
   to, because flat-config `rules` are replaced and not merged** (listing only
   your new one silently deletes the rest; that shipped once and `pnpm lint`
   stayed green). Do not verify this by COUNTING selectors — the count this line
   used to prescribe rotted within one task. Add a row for each file to the
   resolved-selector table in `src/shell/skins-config.test.ts`, which asserts the
   resolved selector LIST by name through `ESLint#calculateConfigForFile`;
   `npx eslint --print-config <file>` is the by-hand version.
   The rule sees identifiers only; the prose channels are yours to grep.
10. **Reset** — restores the data, wipes learned memory, re-seeds beats 4/5, and
    leaves beat 6 unlearned so the demo can run again.

Any beat you deliberately skipped should say so in the beat map. A beat that is
merely absent is a bug.
