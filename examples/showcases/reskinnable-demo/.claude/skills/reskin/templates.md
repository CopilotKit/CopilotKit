# Skin file templates

Copy each block into `src/skins/<id>/<file>` and replace `<id>` / `<Brand>` /
domain specifics. These are written against this app's frozen `Skin` contract
(`src/shell/skin-contract.ts`) and mirror the two shipped skins
(`src/skins/airline/`, `src/skins/banking/`).

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
— it is the debugged reference for the three non-obvious things this chrome MUST
get right:

- **Root is `h-screen overflow-hidden`, not `min-h-screen`, and the `<aside>` is
  `h-full`.** `min-h-screen` is a MINIMUM: on a page taller than the viewport the
  container grows, the whole document scrolls, and the nav scrolls away with it —
  and `<main>`'s own `overflow-y-auto` goes inert because its parent is
  unbounded. `h-screen overflow-hidden` pins the shell to exactly one viewport so
  `<main>` scrolls INSIDE it.
- **Publish the nav insets.** The `useEffect` below tells the shell how wide this
  skin's nav is via `--nw-nav-inset-left` / `--nw-nav-inset-right` on
  `document.documentElement`, so the shell's floating skin selector docks in the
  content band instead of landing on top of your nav. It MUST remove both on
  cleanup — a missing cleanup leaks the inset into whatever skin the user
  switches to next.
- **The meta-utility strip is skin-authored chrome, not shell-provided.** A new
  skin gets no Reset / theme toggle / Help for free — you add them here (see the
  `mt-auto` group). Details in SKILL.md § "The meta-utility strip".

```tsx
"use client";
import "./theme.css"; // side-effect import registers the .theme-<id> block
import { useEffect } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle, RotateCcw } from "lucide-react";
import { useSkin } from "@/shell/skin-provider";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { ThemeToggle } from "@/components/ui/theme-toggle"; // SHARED shell component — importing it is fine
import { useAskCopilot } from "./components/use-ask-copilot"; // PORT this into your skin (see below)
import { cn } from "@/lib/utils";

// The sidebar width doubles as the shell's nav inset — keep them the same value.
const SIDEBAR_WIDTH_PX = 240;

export function <Id>Layout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  const pathname = usePathname();
  const resetEnabled = usePresenterReset();
  const askCopilot = useAskCopilot();
  const Logo = skin.identity.logo;

  const handleReset = async () => {
    if (!window.confirm("Reset demo state? This restores the seeded scenario.")) return;
    const res = await fetch(`/api/${skin.id}/v1/dev/reset`, { method: "POST" });
    if (res.ok) {
      // Hard-navigate to the skin root for a pristine slate (fresh store, cleared
      // canvas, new thread on the next message) AND the clean starting URL.
      window.location.assign(`/${skin.id}`);
    } else {
      window.alert(`Reset failed (HTTP ${res.status}). See the server logs.`);
    }
  };

  // Publish the nav insets so the shell's floating selector never docks on top of
  // this nav. Remove BOTH on cleanup, or the inset leaks into the next skin.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nw-nav-inset-left", `${SIDEBAR_WIDTH_PX}px`);
    root.style.setProperty("--nw-nav-inset-right", "0px");
    return () => {
      root.style.removeProperty("--nw-nav-inset-left");
      root.style.removeProperty("--nw-nav-inset-right");
    };
  }, []);

  return (
    // h-screen + overflow-hidden (NOT min-h-screen): the shell is exactly one
    // viewport tall so the nav stays pinned and <main> scrolls INSIDE it.
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
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
            const href = route.segment ? `/${skin.id}/${route.segment}` : `/${skin.id}`;
            const active = pathname === href;
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

```tsx
"use client";
import { useSkinData } from "@/shell/skin-provider";
import type { <Id>Data } from "../data/use-data";

export function <Id>HomePage() {
  const data = useSkinData<<Id>Data>();
  return <div>{/* render domain UI from `data` */}</div>;
}
```

## `tools.tsx`

Renders `null`. Register frontend tools / HITL / gen-UI components and
`useAgentContext` readables here (all from `@copilotkit/react-core/v2`). Mirror
`src/skins/logistics/tools.tsx` — it is the debugged reference for the two things
this file MUST get right.

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

  // Frontend tool (a write) → render DOES receive { args, status, respond }.
  useFrontendTool(
    {
      name: "doThing",
      description: "Do the thing.",
      parameters: z.object({ id: z.string() }),
      handler: async ({ id }) => `Did the thing to ${id}.`,
      render: ({ status }) => (
        <div className="text-ink-muted">
          {status === ToolCallStatus.Complete ? "Done." : "Working…"}
        </div>
      ),
    },
    [data], // ← deps here too
  );

  return null;
}
```

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

## `suggestions.ts`

```ts
import type { Suggestion } from "@/shell/skin-contract";

export const <id>Suggestions: Suggestion[] = [
  { title: "<pill title>", message: "<prompt sent when clicked>" },
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

## `agent.ts` — SERVER-ONLY (no "use client", no JSX)

Mirror `src/skins/airline/agent.ts` (minimal) or `src/skins/logistics/agent.ts`
(with a canvas tool). Imported ONLY by `src/shell/agent-registry.ts`; the client
skin never imports it.

```ts
import { BuiltInAgent } from "@copilotkit/runtime/v2";

export const <id>Agent = () =>
  new BuiltInAgent({
    model: "openai/gpt-5.4", // the alias used across this repo
    prompt: "You are the <Brand> agent. ...",
    // tools: [...]       // optional server-side agent tools (defineTool)
    // temperature: 0,    // optional
  });
```

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

  // ── Optional slots (omit any you don't need) ──
  // NOTE: airline omits every optional slot below EXCEPT `toolLabels` + `useData`
  // — it ships a 9-entry label map so its activity chips read as human phrases,
  // not raw tool names. If your skin registers named frontend tools, you almost
  // certainly want `toolLabels` too.
  useData: use<Id>Data, // () => unknown — OMIT if the skin has no shell-managed
                        //   data (banking omits it, reads REST + auth directly);
                        //   then useSkinData<T>() returns undefined.
  // Providers,           // ComponentType<{ children: ReactNode }> — stack BELOW CopilotKitProvider
  // CanvasSurface,       // ComponentType — full-region a2ui report surface
  // sandboxFunctions,    // SandboxFunction[] — exposed inside OGUI iframes
  // toolLabels: {        // Record<string, string> — activity-chip labels for your tools
  //   showThing: "Pulling up the thing",
  // },
  // chatHeaderActions: [ // ChatHeaderAction[] — buttons in the shared chat header
  //   { icon: SomeIcon, label: "Do a thing", onClick: () => {} },
  // ],
  // onSuggestionSelect: (suggestion, index) => false, // return true if fully handled

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
