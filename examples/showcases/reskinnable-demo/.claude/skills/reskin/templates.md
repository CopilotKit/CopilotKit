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
```

## `layout.tsx`

Side-effect-import `./theme.css` here so the block loads when the skin mounts.
Style with the shared semantic utilities (`bg-canvas`, `text-ink`,
`border-hairline`, `bg-surface`, `text-brand`, …) so the skin reskins with the
theme. Read the active skin via `useSkin()`.

```tsx
"use client";
import "./theme.css"; // side-effect import registers the .theme-<id> block
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSkin } from "@/shell/skin-provider";

export function <Id>Layout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  const pathname = usePathname();
  const Logo = skin.identity.logo;
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-hairline bg-surface px-4 py-6 md:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2 text-brand">
          <Logo className="h-7 w-7" />
          <span className="text-lg font-bold text-ink">{skin.identity.brand}</span>
        </div>
        <nav className="flex flex-col gap-1">
          {skin.nav.map((route) => {
            const href = route.segment ? `/${skin.id}/${route.segment}` : `/${skin.id}`;
            const active = pathname === href;
            const Icon = route.icon;
            return (
              <Link
                key={route.segment || "index"}
                href={href}
                aria-current={active ? "page" : undefined}
                className={active ? "bg-brand-soft text-brand rounded-xl px-3 py-2.5 text-sm font-medium" : "text-ink-muted hover:bg-surface-muted rounded-xl px-3 py-2.5 text-sm font-medium"}
              >
                {Icon ? <Icon className="mr-3 inline h-4 w-4" /> : null}
                {route.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto px-5 py-6">{children}</main>
    </div>
  );
}
```

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
`useAgentContext` readables here (all from `@copilotkit/react-core/v2`). See
`src/skins/airline/tools.tsx` for `useComponent` / `useFrontendTool` /
`useHumanInTheLoop` patterns.

```tsx
"use client";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import type { <Id>Data } from "./data/use-data";

export function <Id>Tools() {
  const data = useSkinData<<Id>Data>();
  useAgentContext({ description: "<what the agent should know>", value: data });
  // Register useComponent / useFrontendTool / useHumanInTheLoop here as needed.
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

Mirror `src/skins/airline/agent.ts`. Imported ONLY by
`src/shell/agent-registry.ts`; the client skin never imports it.

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
import { use<Id>Data } from "./data/use-data";
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
