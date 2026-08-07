# Skin file templates

Copy each block into `src/skins/<id>/<file>` and replace `<id>` / `<Brand>` /
domain specifics. These are written against this app's frozen `Skin` contract
(`src/shell/skin-contract.ts`) and mirror the four shipped skins
(`src/skins/{banking,airline,logistics,keel}/`) — see
[demo-beats.md](./demo-beats.md) § "Which skin to copy for what" for which one to
open for which problem.

These templates are the **wiring floor**, not a finished skin. A skin also has to
hit the demo beats (SKILL.md § "FIRST: a skin is a live sales demo"); where a
template slot is load-bearing for a beat, it says so.

Throughout: replace `<id>` with your lowercase skin id (e.g. `support`) and
`<Id>` with the PascalCase form (e.g. `Support`). The id must equal the route
segment, `themeClass` (`theme-<id>`), and the agent id.

---

## `identity.ts`

A `.ts` file (no JSX) — build the logo with `createElement`, exactly like
`src/skins/airline/identity.ts` and `src/skins/banking/identity.ts`.

```ts
import { createElement } from "react";

function <Id>Logo({ className }: { className?: string }) {
  // `currentColor` so the mark inherits the brand color wherever it mounts
  // (nav, selector, chat header).
  return createElement(
    "svg",
    {
      className,
      viewBox: "0 0 24 24",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
    },
    createElement("path", { d: "M4 13.5L9 7l4 4.5L20 4", stroke: "currentColor", strokeWidth: 2.2 }),
  );
}

export const <id>Identity = {
  brand: "<Brand>",
  tagline: "<one-line tagline>",
  logo: <Id>Logo,
  // favicon?:       emoji browser-tab icon (e.g. "🛟") — the shell's FaviconSync
  //                 renders it into a <link rel="icon"> per skin; omit for the
  //                 static favicon.ico
  // assistantName?: chat header title (defaults to brand)
  // greeting?:      chat welcome message (defaults to tagline)
} as const;
```

## `theme.css`

Re-value shared tokens ONLY (the names are declared in `src/app/globals.css`).
Do not add new token names. Values are HSL channels, space-separated (the shell
wraps them in `hsl(...)`). The re-valuable set (see `src/skins/airline/theme.css`
for a full, working example): `--brand`, `--brand-violet`, `--brand-indigo`,
`--brand-foreground`, `--brand-soft`, `--background`, `--foreground`, `--canvas`,
`--surface`, `--surface-muted`, `--ink`, `--ink-muted`, `--hairline`,
`--positive`, `--positive-soft`, `--negative`, `--negative-soft`, `--radius`.

```css
.theme-<id > {
  --radius: 1.125rem;

  /* OPT-IN dark mode. `src/hooks/use-theme.ts` forces any skin WITHOUT this flag
     to light and ignores the stored dark preference, so a `.dark .theme-<id>`
     block below does NOTHING unless you also set this. Set it (and ship the dark
     block) to make the theme toggle a real control; omit BOTH to stay light-only
     — a legitimate choice (airline does it). Without the flag the toggle in your
     layout is a dead button. */
  --nw-dark-capable: 1;

  --brand: 252 83% 67%;
  --brand-violet: 252 83% 67%;
  --brand-indigo: 248 84% 60%;
  --brand-foreground: 0 0% 100%;
  --brand-soft: 252 90% 96%;

  --background: 255 60% 99%;
  --foreground: 252 30% 14%;
  --canvas: 255 60% 97%;
  --surface: 0 0% 100%;
  --surface-muted: 252 40% 98%;
  --ink: 252 30% 14%;
  --ink-muted: 250 12% 46%;
  --hairline: 252 30% 92%;

  --positive: 152 62% 40%;
  --positive-soft: 152 70% 95%;
  --negative: 349 78% 56%;
  --negative-soft: 349 90% 96%;
}

/* DARK — ship this ONLY if you set `--nw-dark-capable: 1` above. `.dark` lands on
   <html> (an ancestor of the `.theme-<id>` root), so this descendant selector
   re-values only the tokens that DIFFER — surfaces, ink, and semantic tokens —
   and lets the brand ramp and `--radius` inherit from the light block.
   (Mirror `src/skins/logistics/theme.css` / `src/skins/banking/theme.css`.) */
.dark .theme-<id > {
  color-scheme: dark;

  --background: 252 20% 8%;
  --foreground: 255 30% 95%;
  --canvas: 252 20% 8%;
  --surface: 252 16% 12%;
  --surface-muted: 252 14% 15%;
  --ink: 255 30% 95%;
  --ink-muted: 250 10% 62%;
  --hairline: 252 12% 22%;

  --brand-soft: 252 40% 20%;

  --positive: 152 52% 50%;
  --positive-soft: 152 35% 15%;
  --negative: 349 76% 64%;
  --negative-soft: 349 40% 18%;
}
```

## `layout.tsx`

Side-effect-import `./theme.css` here so the block loads when the skin mounts.
Style with the shared semantic utilities (`bg-canvas`, `text-ink`,
`border-hairline`, `bg-surface`, `text-brand`, …) so the skin reskins with the
theme. Read the active skin via `useSkin()`. Mirror `src/skins/logistics/layout.tsx`
— it is the debugged reference for the two non-obvious things this chrome MUST
get right:

- **Root is `h-full overflow-hidden` — not `h-screen`, not `min-h-screen` — and the
  `<aside>` is `h-full`.** This chrome fills the shell's app CARD, which the frame
  has already inset by its own padding, so a viewport-height root overflows the card
  by that padding. It must still be BOUNDED: if the container can grow past the card
  the whole document scrolls, the nav scrolls away with it, and `<main>`'s own
  `overflow-y-auto` goes inert because its parent is unbounded. `h-full
overflow-hidden` bounds it to the card so `<main>` scrolls INSIDE it.
- **The meta-utility strip is skin-authored chrome, not shell-provided.** A new
  skin gets no Reset / theme toggle / Help for free — you add them here (see the
  `mt-auto` group). Details in SKILL.md § "The meta-utility strip".

```tsx
"use client";
import "./theme.css"; // side-effect import registers the .theme-<id> block
import type { ReactNode } from "react";
import Link from "next/link";
import { HelpCircle, RotateCcw } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref, useSkinSegments } from "@/shell/skin-path";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { ThemeToggle } from "@/components/ui/theme-toggle"; // SHARED shell component — importing it is fine
import { useAskCopilot } from "./components/use-ask-copilot"; // PORT this into your skin (see below)
import { cn } from "@/lib/utils";

// The sidebar width doubles as the shell's nav inset — keep them the same value.
const SIDEBAR_WIDTH_PX = 240;

export function <Id>Layout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  // EVERY in-skin link goes through skinHref — never a hardcoded `/${skin.id}/…`.
  // Under LOCK_SKIN the deploy is served AT `/` with the skin segment gone from
  // the URL space, and a hardcoded prefix puts it straight back in the address
  // bar on the first nav click. See src/shell/skin-path.ts and src/proxy.ts.
  const skinHref = useSkinHref(skin.id);
  const resetEnabled = usePresenterReset();
  const askCopilot = useAskCopilot();
  const Logo = skin.identity.logo;

  // BEAT 3b — the ROUTE readable. Without this the agent cannot tell which page
  // is open, so "what's on my screen?" answers identically everywhere and the
  // beat dies. Pages register their own readables for what is visibly rendered.
  //
  // Derive the segment RELATIVE to the skin base, or you report the skin id
  // instead of a page — the exact bug banking hit before its cutover, when this
  // read `pathname.split("/")[1]` and every page answered "banking".
  // useSkinSegments handles the base for you. Do NOT hand-roll it with a fixed
  // `.slice(2)`: that eats the first real segment on a LOCK_SKIN deploy, where
  // the pathname has no prefix to skip.
  const restHead = useSkinSegments(skin.id)[0] ?? "";
  useAgentContext({
    description: "The current page where the user is",
    // Name the INDEX page something meaningful, not "" — in banking `/banking`
    // IS the Credit Cards view, so it reports "cards".
    value: restHead === "" ? "<index page name>" : restHead,
  });

  const handleReset = async () => {
    if (!window.confirm("Reset demo state? This restores the seeded scenario.")) return;
    const res = await fetch(`/api/${skin.id}/v1/dev/reset`, { method: "POST" });
    if (res.ok) {
      // Hard-navigate to the skin root for a pristine slate (fresh store, cleared
      // canvas, new thread on the next message) AND the clean starting URL —
      // which is `/` itself on a locked single-tenant deploy.
      window.location.assign(skinHref());
    } else {
      window.alert(`Reset failed (HTTP ${res.status}). See the server logs.`);
    }
  };

  return (
    // h-full + overflow-hidden (NOT h-screen / min-h-screen): this chrome fills the
    // shell's app CARD, which is already inset by the frame's padding. Bounded to
    // the card so the nav stays pinned and <main> scrolls INSIDE it.
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <aside
        className="hidden h-full shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex"
        style={{ width: SIDEBAR_WIDTH_PX }}
      >
        <div className="mb-7 flex items-center gap-2.5 px-2 text-brand">
          <Logo className="h-7 w-7" />
          <span className="text-base font-bold tracking-tight text-ink">{skin.identity.brand}</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {skin.nav.map((route) => {
            const href = skinHref(route.segment);
            // Compare SEGMENTS, not the whole pathname: under a lock the href is
            // prefix-free while the matched route is not, so `pathname === href`
            // is not reliably true for the active entry.
            const active = restHead === route.segment;
            const Icon = route.icon;
            return (
              <Link
                key={route.segment || "index"}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                )}
              >
                {Icon ? <Icon className="h-4 w-4" /> : null}
                {route.label}
              </Link>
            );
          })}
        </nav>

        {/* Meta-utility strip — skin-authored chrome, pinned to the bottom.
            Reset is presenter-gated; the theme toggle is a dead control unless
            your theme.css also ships a dark palette (see `--nw-dark-capable`). */}
        <div className="mt-auto flex items-center gap-1 border-t border-hairline px-1 pt-3">
          {resetEnabled && (
            <button
              type="button"
              onClick={handleReset}
              aria-label="Reset demo state"
              className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <ThemeToggle />
          <button
            type="button"
            aria-label="Ask the copilot for help"
            onClick={() => void askCopilot("What can you help me with here? Give me a short list.")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto px-5 py-6">{children}</main>
    </div>
  );
}
```

`useAskCopilot` (the Help control's handler) is **ported, not imported** — copy
`src/skins/logistics/components/use-ask-copilot.ts` into your own
`src/skins/<id>/components/`. A skin's only inbound dependency is the `Skin`
contract, so it must never reach into `src/skins/banking/**` or any other skin.
`ThemeToggle`, by contrast, lives in the SHARED `src/components/ui/` and is fair
to import directly. And keep the button and the endpoint in agreement: your
skin's `dev/reset` route should allow the reset when
`presenterResetEnabled() || process.env.NODE_ENV !== "production"` (mirror
`src/app/api/logistics/v1/dev/reset/route.ts`) — otherwise a production booth
shows a Reset button that 403s.

## `data/use-data.ts` (OPTIONAL → `useData`)

The seed-backed hook the shell runs inside `SkinProvider`. For an **in-memory**
skin, hold state locally (mirror `src/skins/airline/data/use-data.ts`) and set
`useData` on the skin. A **REST-backed** skin with no shell-managed data can
**omit `useData` entirely** and have components read the backend directly — that
is what banking does (it reads REST via `useCreditCards` and the member via
`useAuthContext`, and never sets `useData`). When `useData` is omitted,
`useSkinData<T>()` returns `undefined`, so only add this file if your components
will actually consume it.

```ts
"use client";
import { useState } from "react";

const SEED = [/* seed rows */];

export function use<Id>Data() {
  const [items, setItems] = useState(SEED);
  return { items, setItems };
}
export type <Id>Data = ReturnType<typeof use<Id>Data>;
```

## `pages/<page>.tsx`

One component per nav segment. Read the skin's data via `useSkinData<T>()`.

**Each page registers its own on-screen readable** (beat 3b). The route readable in
`layout.tsx` says _which_ page is open; this says _what is on it_ — the active
filters and the rows actually rendered after filtering and sorting, not the whole
data set. That distinction is the beat: the agent describing what the user can
literally see. Mirror `src/skins/banking/pages/charges.tsx:139`.

```tsx
"use client";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import type { <Id>Data } from "../data/use-data";

export function <Id>HomePage() {
  const data = useSkinData<<Id>Data>();
  const visible = /* the rows actually rendered, after filter + sort */ [];

  // BEAT 3b — what is VISIBLY on screen right now, not the whole data set.
  useAgentContext({
    description:
      "The <Page> page the user is currently viewing: the active filters/sort " +
      "and the visible rows, in the order shown.",
    value: JSON.stringify({
      page: "<segment>",
      filters: {
        /* the live filter/sort state */
      },
      visibleCount: visible.length,
      rows: visible.slice(0, 25), // cap it — this rides on every request
    }),
  });

  return <div>{/* render domain UI from `data` */}</div>;
}
```

## `tools.tsx`

Renders `null`. Register frontend tools / HITL / gen-UI components and
`useAgentContext` readables here (all from `@copilotkit/react-core/v2`). Mirror
`src/skins/logistics/tools.tsx` for the wiring and
`src/skins/banking/tools.tsx` for the beats — between them they are the debugged
reference for the four things this file MUST get right.

**1. Every registration closes with a deps array.** `useComponent`,
`useFrontendTool`, and `useHumanInTheLoop` each take an **optional deps array as
a second argument** (`useFrontendTool(tool, deps?: ReadonlyArray<unknown>)`,
`useHumanInTheLoop(tool, deps?)`, `useComponent(spec, deps?)` — see the installed
types in `@copilotkit/react-core/dist/copilotkit-CBCT7BlL.d.cts`). Omit it and
the render/handler closure captures whatever the data was at REGISTRATION time —
for a REST-backed skin, the EMPTY array from before the first fetch — **forever**.
This is the worst class of bug because it **compiles, lints, and passes every
test**: the agent narrates confidently ("the trade-offs are on screen") while the
component renders its "not found" branch over stale/empty data. Banking documents
the same trap in a code comment (search "closure captures empty arrays" in
`src/skins/banking/tools.tsx`). Pass the data each closure reads.

**2. A parameterized `useComponent` render receives the schema output DIRECTLY.**
`render: ({ myParam }) => …` — NOT `{ args }`. Per the installed types,
`InferRenderProps<T> = T extends StandardSchemaV1 ? InferSchemaOutput<T> : any`
and `render: ComponentType<NoInfer<InferRenderProps<TSchema>>>`. By contrast
`useHumanInTheLoop` and `useFrontendTool` renders DO receive `{ args, status,
respond }`. Do not copy the HITL `{ args }` shape into a `useComponent`.

**3. Renders must be REPLAY-SAFE — key them off `result`, not `status`** (beat 2).
Reopening a thread replays recorded tool calls: you get the stored `result` and no
live status transition. A render keyed on `status` is perfect live and blank or
wrong on revisit — precisely when "reload and it's still there" is being demoed.
Banking is the only skin written this way (`tools.tsx:70-89`, `418-451`,
`553-572`).

**4. Readables must make the agent PAGE-AWARE** (beat 3b). Global readables
(who the user is, the whole data set) are not enough: "what's on my screen?"
returns the same answer everywhere without a **route** readable in `layout.tsx`
plus **per-page** readables describing what is visibly rendered. Register the
on-screen ones inside the page components, close to the state they describe —
banking's richest is in `charges.tsx:139`, emitting the page name, active
filters, visible row count and the first 25 visible rows.

```tsx
"use client";
import { z } from "zod";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import type { <Id>Data } from "./data/use-data";

export function <Id>Tools() {
  // If your skin sets `useData`, read it here. For a NO-DATA skin (banking /
  // logistics path) `useSkinData` returns undefined — never feed that raw into
  // useAgentContext; guard it (or read your own REST hook / auth context here).
  const data = useSkinData<<Id>Data>();

  useAgentContext({
    description: "<what the agent should know>",
    value: JSON.stringify(data ?? {}), // ?? {} — data is undefined for a no-data skin
  });

  // Gen-UI, NO parameters → render takes no schema arg.
  useComponent(
    {
      name: "showThing",
      description: "Display the current thing.",
      render: () => <div className="text-ink">{/* render from `data` */}</div>,
    },
    [data], // ← deps: re-register when data changes, or the closure captures stale data
  );

  // Gen-UI, PARAMETERIZED → render receives the schema output DIRECTLY, not { args }.
  useComponent(
    {
      name: "showThingById",
      description: "Display one thing by id.",
      parameters: z.object({ id: z.string().describe("The thing's id.") }),
      render: ({ id }) => <div className="text-ink">{/* look `id` up in `data` */}</div>,
    },
    [data],
  );

  // Frontend tool (a write) → render receives { name, toolCallId, args, status,
  // result } (a discriminated union; `result` is defined only when Complete).
  //
  // REPLAY-SAFE: key the finished state off `result`, NOT off `status` (beat 2).
  // On thread reopen you get the recorded result and no live status transition,
  // so a status-keyed render goes blank exactly when someone revisits the thread.
  useFrontendTool(
    {
      name: "doThing",
      description: "Do the thing.",
      parameters: z.object({ id: z.string() }),
      // Return everything the render needs to rebuild itself from history — but
      // NEVER a secret (beat 3a): whatever you return is stored in the thread.
      handler: async ({ id }) => `Did the thing to ${id}.`,
      render: ({ result, args }) =>
        result ? (
          // Give the audience something to SEE (beat presentation rule): a badge,
          // a forced emoji prefix, a highlight ring — not just the word "Done."
          <div className="text-ink">✅ {result}</div>
        ) : (
          <div className="text-ink-muted">Working on {args?.id}…</div>
        ),
    },
    [data], // ← deps here too
  );

  return null;
}
```

`ToolCallStatus` is still the right import when you genuinely need the in-flight
distinction (`InProgress` vs `Executing`); just don't make the **completed** state
depend on it.

## `catalog/index.tsx`

Minimal (no a2ui report surface): pass empty definitions/renderers. For a real
catalog with Zod definitions + React renderers, mirror
`src/skins/airline/catalog/index.tsx`.

```ts
import { createCatalog } from "@copilotkit/a2ui-renderer";

export const <id>Catalog = createCatalog(
  {}, // component definitions (Zod-schema props)
  {}, // renderers
  { catalogId: "<id>", includeBasicCatalog: false },
);
```

## `suggestions.ts` — ONE PILL PER BEAT, IN DEMO ORDER

The pills ARE the demo script. The presenter must never have to type: "make sure
that the bubbles are in there so I never have to type, I could just click." This
is also a correctness measure — free-typed phrasing routes to the wrong tool
(saying "spending **report**" instead of "trend" sends banking to the canvas
report tool instead of the in-chat chart). Keep the beat map from
[demo-beats.md](./demo-beats.md) in a comment at the top so the mapping can't rot.

Banking ships 8 pills covering its whole flow; airline/logistics/keel ship 4–5
and cover it partially — copy banking's coverage, not their count.

```ts
import type { Suggestion } from "@/shell/skin-contract";

// Shared with `onSuggestionSelect` in skin.tsx so the match can never drift
// (beat 3d — the framework's suggestion path drops attachments, so the pill that
// carries a file has to be intercepted by exact message match).
export const <ID>_ATTACHMENT_MESSAGE =
  "<the prompt that must ride along with the staged file>";

// Beat map — keep in sync with the demo:
//   1  face          → pill 1
//   2  rich thread   → no pill (reload + reopen a thread)
//   3a drive the app → pill 2
//   3b sees screen   → pill 3 (click it on TWO different pages)
//   3c levers        → pill 4
//   3d multimodal    → pill 5 (intercepted, stages the file)
//   4  memory        → pill 6
//   5  stored skill  → pill 7
//   6  teach a skill → pill 8
export const <id>Suggestions: Suggestion[] = [
  // 1 — lead with generative UI, never a wall of text.
  { title: "<show the headline visual>", message: "<...>" },
  // 3a — a mutation whose secret never reaches the assistant.
  { title: "<change the sensitive thing>", message: "<...>" },
  // 3b — ask it on one page, navigate, ask it again.
  {
    title: "What's on my screen?",
    message:
      "Look at the page I'm on right now and tell me what's on screen — the key elements and the figures shown.",
  },
  // 3c — HITL confirm, then navigate + sort + filter, visibly highlighted.
  { title: "<the complicated maneuver>", message: "<...>" },
  // 3d — intercepted in skin.tsx; stages the bundled file.
  { title: "<produce the artifact>", message: <ID>_ATTACHMENT_MESSAGE },
  // 4 — recalls a seeded preference AND names it.
  { title: "<the format-sensitive question>", message: "<...>" },
  // 5 — one vague sentence replays a seeded procedure.
  { title: "<I don't recognize this — handle it>", message: "<...>" },
  // 6 — the gated action it does NOT know how to do yet.
  { title: "<the gated action>", message: "<...>" },
];
```

## `design-skill.ts`

```ts
export const <ID>_DESIGN_SKILL =
  "OGUI design brief: describe the visual language for generated UIs " +
  "(palette, shapes, tone). Injected as agent context.";
```

## `providers.tsx` — OPTIONAL (`Providers` / `RuntimeProviders` / `useRuntimeProperties`)

Only if your skin needs extra providers. Two distinct slots live here (mirror
`src/skins/banking/providers.tsx`):

- **`Providers`** mounts **below** `CopilotKitProvider` — for providers that
  _consume_ the CopilotKit context (e.g. tools registered from context).
- **`RuntimeProviders` + `useRuntimeProperties`** mount **above**
  `CopilotKitProvider` — the sanctioned way to contribute end-user identity /
  runtime `properties`. Use these ONLY if your skin scopes Intelligence runs or
  durable memory per end-user; a skin with its own auth needs them (there is no
  other correct place to source `properties` — a child racing `setProperties`
  after mount is exactly the bug they exist to prevent). Pair them with a
  server-safe `identifyUser` (below). Omit all three if you don't need them.

```tsx
"use client";
import { useMemo, type ReactNode } from "react";
// import { <Id>AuthProvider, use<Id>Auth } from "./components/auth-context";

// Below CopilotKitProvider — providers that consume the CopilotKit context.
export function <Id>Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// Above CopilotKitProvider — establishes the context useRuntimeProperties reads.
export function <Id>RuntimeProviders({ children }: { children: ReactNode }) {
  // return <<Id>AuthProvider>{children}</<Id>AuthProvider>;
  return <>{children}</>;
}

// Threaded into CopilotKitProvider's `properties` prop by the shell. Return a
// STABLE/memoized object; do NOT set `a2uiCatalogAvailable` (the shell adds it).
export function use<Id>RuntimeProperties(): Record<string, unknown> | undefined {
  // const { user } = use<Id>Auth();
  return useMemo(() => ({ /* userRole, userId */ }), [/* user?.role, user?.id */]);
}
```

## `intelligence/user-id.ts` — OPTIONAL, SERVER-ONLY identity resolver

Only if your skin scopes per-user memory. Reached through the **server-only**
`agent-registry.ts`, so it MUST be server-safe: **no `"use client"`, no JSX, no
`.tsx` imports.** Mirror `src/skins/banking/intelligence/user-id.ts`.

```ts
// server-safe: plain .ts, no "use client", no JSX
import type { IdentifyRunUser } from "@/shell/agent-registry";

export const <id>IdentifyUser: IdentifyRunUser = (properties) => {
  const userId = properties?.userId ?? "<id>-demo-user";
  return { id: userId, name: properties?.userRole ?? "<Brand> User" };
};
```

## `intelligence/seed-memories.ts` — REQUIRED for beats 4 and 5

"It already knows me" is a **file**, not emergent behaviour. Mirror
`src/skins/banking/intelligence/seed-memories.ts` — the only implementation in
the repo, and its comments are worth reading in full. Server-safe plain `.ts`.
Called by your `dev/reset` route immediately after wiping memories, so the demo
is re-armed before the presenter says a word.

Three design rules, each learned the hard way:

- **Seed a standing PREFERENCE, not a fact** (beat 4). "Alex's favourite food"
  proves storage; "group spend by team, over-limit first, rounded to whole
  dollars" proves _applied_ learning, because recall visibly changes the answer to
  a question the user never re-explained.
- **The procedure must run FULLY AUTOMATICALLY — no confirmation gate** (beat 5).
  Banking's note step used to open an approval card; if the presenter moved on
  without answering it, that tool call sat unresolved and the **next message
  failed the whole thread** with `Tool result is missing for tool call ...`. A
  procedure with no half-finished state has nothing to leave behind. Put "run all
  of them immediately, in order, without asking for confirmation" in the memory
  text itself.
- **Keep beat 5's procedure and beat 6's DISJOINT, and never seed beat 6's.**
  Seeding the teachable one means the agent already knows the answer and never
  offers to record — the entire teach arc vanishes.

```ts
// server-safe: plain .ts, no "use client", no JSX
export interface SeedMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
}

interface SeedMemory {
  kind: "topical" | "episodic" | "operational";
  scope: "user" | "project";
  content: string;
}

export const SEED_MEMORIES: readonly SeedMemory[] = [
  {
    // BEAT 4 — a standing preference, so recall CHANGES the answer.
    kind: "topical",
    scope: "user",
    content:
      "<Name> prefers <the format/ordering/rounding preference>, so answers " +
      "should apply it without being asked.",
  },
  {
    // BEAT 5 — a PROCEDURE, so recall produces visible ACTION (several tool
    // calls in a row) rather than a reformatted answer. Disjoint from beat 6's.
    kind: "operational",
    scope: "project",
    content:
      "Procedure for <the beat-5 situation> (NOT for <the beat-6 situation>): " +
      "(1) <first tool>, (2) <second tool>, (3) <third tool, with the visible " +
      "affordance — e.g. prefix the note with 🚨 so it stands out>. Run all " +
      "three immediately, in order, without asking for confirmation, then " +
      "confirm what was done in one short sentence.",
  },
  // DO NOT seed beat 6's procedure. That one is taught live on stage.
];

/**
 * Write the seed memories for one identity; returns how many were stored.
 * Never throws — a booth reset must still report success for the data store even
 * if the memory backend is unhappy, so failures are counted, not propagated.
 */
export async function seedMemories(
  params: SeedMemoriesParams,
): Promise<number> {
  const { apiUrl, apiKey, userId } = params;
  const base = apiUrl.replace(/\/$/, "");
  let stored = 0;

  for (const memory of SEED_MEMORIES) {
    try {
      const res = await fetch(`${base}/api/memories`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Cpki-User-Id": userId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(memory),
      });
      if (res.ok) stored += 1;
      else console.error(`[seed-memories] ${userId}: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[seed-memories] ${userId}: ${String(err)}`);
    }
  }

  return stored;
}
```

Seed the memories against the **same identity your `identifyUser` asserts** for
the default demo user, or the agent's own `recall_memory` will not find them.
Banking pairs this with `intelligence/forget-memories.ts` so `dev/reset` can wipe
learned memories and then re-seed these — see SKILL.md § "The meta-utility strip"
and demo-beats.md § "Presentation requirements".

## `agent.ts` — SERVER-ONLY (no "use client", no JSX)

Mirror `src/skins/airline/agent.ts` (minimal) or `src/skins/logistics/agent.ts`
(with a canvas tool). Imported ONLY by `src/shell/agent-registry.ts`; the client
skin never imports it.

```ts
import { BuiltInAgent } from "@copilotkit/runtime/v2";

export const <id>Agent = () =>
  new BuiltInAgent({
    model: "openai/gpt-5.4", // the alias used across this repo
    prompt: <ID>_PROMPT,
    // tools: [...]       // optional server-side agent tools (defineTool)
    temperature: 0, // banking pins 0 — a demo has to behave the same every run
  });
```

### The prompt is where the beats are enforced

Most beats fail in the **prompt**, not in the wiring: the tools exist, the agent
just doesn't use them the way the demo needs. Banking's prompt is one long string
of named clauses (`src/skins/banking/agent.ts`) — copy the clause set, not the
banking specifics. The clauses that carry beats:

| Clause                        | Beat            | What it must say                                                                                                                                                                                                                                |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHART / COMPONENT ANSWER RULE | 1               | Render the visual **and** answer in one or two sentences. Never one without the other.                                                                                                                                                          |
| NEVER WRITE A MARKDOWN TABLE  | 1, presentation | If a gen-UI component exists for that data, route to it instead of emitting a table.                                                                                                                                                            |
| SCREEN AWARENESS              | 3b              | "The context you are given IS your view of what the user is looking at." Name the current page, summarize the key elements, cite the actual figures, and **never** say you cannot see/inspect/read the screen.                                  |
| SECRETS                       | 3a              | Never ask for the sensitive value, never repeat it, and don't ask which record first — fire the tool immediately.                                                                                                                               |
| UPLOADED DOCUMENTS            | 3d              | Read the attachment, and merge its values into the artifact tool's payload (banking passes them through `createReport`'s `additions` array).                                                                                                    |
| RECALL FIRST                  | 4               | Before answering this class of question, call `recall_memory`, then pass what you recalled into the component **and name the preference you applied**. Speak like a person who remembers.                                                       |
| SAVED PROCEDURE               | 5               | Recall, then EXECUTE step by step without asking for confirmation. Resolve the named entity to its id from context. State plainly that this is a DIFFERENT procedure from beat 6's — "do not confuse the two, do not offer to record anything." |
| FINDING IS NOT DOING          | 5               | Locating the record is not handling it. Carry the procedure through.                                                                                                                                                                            |
| ACTION DISCIPLINE             | 6               | When there is no saved procedure, decline and offer to record — never improvise or bluff a fix.                                                                                                                                                 |
| TEACH & RECALL                | 6               | The record → save → replay chain, and "save this procedure AT MOST ONCE".                                                                                                                                                                       |
| PROSE STYLE                   | presentation    | Short answers, **bold** the key figures, no walls of text.                                                                                                                                                                                      |

Also keep the **tool descriptions** doing routing work: banking puts a shared
`CHART_ANSWER_RULE` in each chart tool's description and states which question
shape each tool owns, which is what keeps "show me the trend" off the canvas
report path.

**If your skin has a `CanvasSurface`, emit its a2ui operations from a SERVER tool
here — never from a client `useFrontendTool`.** The a2ui middleware only converts
the `{ [A2UI_OPERATIONS_KEY]: buildOps(spec) }` payload into an `a2ui-surface`
activity when it observes it in an in-stream `TOOL_CALL_RESULT` event, which a
client frontend-tool result does NOT produce — do it client-side and the canvas
stays permanently blank. Both banking (`render_report`) and logistics
(`renderBrief`) do it server-side. Register the tool on the `BuiltInAgent` with
`defineTool` (read `src/skins/logistics/agent.ts` for the full worked pattern —
the tool takes agent-chosen selections + LABEL-only text and deterministically
expands them into ops, so numbers bind to live client data, never the model):

```ts
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
// build-*-ops.ts is server-safe (plain Zod + string constants — no React/.tsx):
import { renderReportParams, buildReportOps, A2UI_OPERATIONS_KEY } from "./build-report-ops";

const renderReportTool = defineTool({
  name: "renderReport",
  description: "Build the report on the canvas. Supply selections + LABEL-ONLY text — never numbers.",
  parameters: renderReportParams,
  execute: async (spec) => ({ [A2UI_OPERATIONS_KEY]: buildReportOps(spec) }),
});

export const <id>Agent = () =>
  new BuiltInAgent({
    model: "openai/gpt-5.4",
    prompt: "You are the <Brand> agent. ...",
    tools: [renderReportTool],
  });
```

## `skin.tsx` — assembles the contract (NEVER imports agent.ts)

```tsx
"use client";
import type { ComponentType } from "react";
import type { Skin } from "@/shell/skin-contract";
import { <id>Identity } from "./identity";
import { <Id>Layout } from "./layout";
import { <Id>HomePage } from "./pages/home";
import { <Id>Tools } from "./tools";
import { <id>Catalog } from "./catalog";
import { <id>Suggestions } from "./suggestions";
import { <ID>_DESIGN_SKILL } from "./design-skill";
import { use<Id>Data } from "./data/use-data"; // NO-DATA skin: delete this import AND the `useData` field below
// import { <Id>Providers, <Id>RuntimeProviders, use<Id>RuntimeProperties } from "./providers";

const PAGES: Record<string, ComponentType> = {
  "": <Id>HomePage,
  // "reports": <Id>ReportsPage,
};

const <id>: Skin = {
  id: "<id>",
  identity: <id>Identity,
  themeClass: "theme-<id>",
  Layout: <Id>Layout,
  nav: [{ segment: "", label: "Home" }],
  resolvePage: (segments) => PAGES[segments.length === 0 ? "" : segments.join("/")] ?? null,
  Tools: <Id>Tools,
  catalog: <id>Catalog,
  suggestions: <id>Suggestions,
  designSkill: <ID>_DESIGN_SKILL,

  // ── Optional slots ──
  // "Optional" per the CONTRACT; a demo-complete skin sets most of them. Airline
  // omits every one below EXCEPT `toolLabels` + `useData` — and airline hits one
  // beat of nine, so do not read its restraint as a model. `toolLabels` in
  // particular is optional in name only: it is what makes activity chips read as
  // human phrases ("Pulling up your flight") instead of raw tool names
  // (`showFlight`). Any skin with named frontend tools wants it.
  useData: use<Id>Data, // () => unknown — OMIT if the skin has no shell-managed
                        //   data (banking omits it, reads REST + auth directly);
                        //   then useSkinData<T>() returns undefined.
  // Providers,           // ComponentType<{ children: ReactNode }> — stack BELOW CopilotKitProvider
  // CanvasSurface,       // ComponentType — full-region a2ui report surface
  // sandboxFunctions,    // SandboxFunction[] — exposed inside OGUI iframes
  // toolLabels: {        // Record<string, string> — activity-chip labels for your tools
  //   showThing: "Pulling up the thing",
  // },
  // BEAT 3d — the attachment path. The framework's suggestion path DROPS
  // attachments, so a pill that must carry a file has to be intercepted here:
  // stage the file into the composer's hidden input[type=file], then drive the
  // real composer textarea + send button. Match on the message CONSTANT shared
  // with suggestions.ts so it can never drift. Ship the paperclip too, so the
  // presenter can stage the file by hand if the pill path misbehaves on stage.
  // (Worked implementation: banking's `skin.tsx:87-149` + `attach-invoice.ts`.)
  // chatHeaderActions: [ // ChatHeaderAction[] — buttons in the shared chat header
  //   { icon: Paperclip, label: "Attach the <artifact>", onClick: stage<Id>Attachment },
  // ],
  // onSuggestionSelect: (suggestion) => {
  //   if (suggestion.message !== <ID>_ATTACHMENT_MESSAGE) return false;
  //   void send<Id>WithAttachment();
  //   return true; // fully handled — the shell does nothing further
  // },

  // ── End-user identity (ONLY if your skin scopes Intelligence per user) ──
  // Mount above CopilotKitProvider + contribute its `properties`; pair with a
  // server-safe `identifyUser` in agent-registry.ts. Banking uses all three;
  // airline none. See the "Contributing end-user identity" section in SKILL.md.
  // RuntimeProviders: <Id>RuntimeProviders,         // ComponentType<{ children: ReactNode }>
  // useRuntimeProperties: use<Id>RuntimeProperties, // () => Record<string, unknown> | undefined
};

export default <id>;
```

## Multi-page `nav` + `resolvePage`

```tsx
nav: [
  { segment: "", label: "Home" },
  { segment: "reports", label: "Reports" },
],
resolvePage: (segments) => {
  const key = segments.length === 0 ? "" : segments.join("/");
  return { "": <Id>HomePage, reports: <Id>ReportsPage }[key] ?? null; // else → 404
},
```
