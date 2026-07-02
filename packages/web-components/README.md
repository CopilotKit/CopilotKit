# @copilotkit/web-components

Framework-agnostic, shadow-DOM [Lit](https://lit.dev) custom elements for CopilotKit.

This package currently ships **`<copilotkit-threads-drawer>`** — a public, self-contained,
controlled threads drawer. It is a pure **VIEW**: domain data flows in as
properties and user intent flows out as DOM `CustomEvent`s. It imports no React,
Angular, or `@copilotkit/core` code and renders correctly in any host page,
surviving hostile host CSS (`all: unset`, Tailwind preflight `!important`).

## Install

```bash
npm install @copilotkit/web-components lit
```

`lit` is a peer/runtime dependency so the host dedupes a single Lit runtime.

## Usage

```ts
import { defineCopilotKitThreadsDrawer } from "@copilotkit/web-components/threads-drawer";

defineCopilotKitThreadsDrawer(); // registers <copilotkit-threads-drawer> (idempotent)
```

```html
<copilotkit-threads-drawer active-thread-id="t-123"></copilotkit-threads-drawer>
<script>
  const drawer = document.querySelector("copilotkit-threads-drawer");
  drawer.threads = [
    {
      id: "t-123",
      name: "My thread",
      archived: false,
      createdAt: "...",
      updatedAt: "...",
    },
  ];
  drawer.addEventListener("thread-selected", (e) => open(e.detail.threadId));
  drawer.addEventListener("new-thread", () => createThread());
</script>
```

### Inbound properties (DOMAIN state — owned by the consumer)

| property         | type             | notes                                           |
| ---------------- | ---------------- | ----------------------------------------------- |
| `threads`        | `DrawerThread[]` | the element re-orders + filters authoritatively |
| `loading`        | `boolean`        | initial-fetch loading                           |
| `error`          | `string \| null` | initial-fetch error → actionable Retry          |
| `activeThreadId` | `string \| null` | drives selection highlight                      |
| `licensed`       | `boolean`        | `false` → upsell replaces the list              |
| `fetchingMore`   | `boolean`        | in-flight pagination                            |
| `fetchMoreError` | `string \| null` | inline "couldn't load more — retry"             |
| `open`           | `boolean`        | externally controllable (mobile coordination)   |
| `collapsed`      | `boolean`        | desktop collapse-to-rail                        |

### Outbound events (INTENT — bubbling + composed `CustomEvent`s)

`thread-selected`, `archive`, `unarchive`, `delete` (after in-element confirm),
`new-thread`, `filter-change`, `open-change`, `retry` (`{ scope }`), `upsell`.

The element owns VIEW state: open/collapsed, the Active/All filter, the
confirm-delete dialog, and per-row entry/reveal animations.

## Theming (hybrid)

- **CSS variables** pierce the shadow boundary — set `--cpk-drawer-*`
  (`-bg`, `-fg`, `-surface`, `-accent`, `-primary`, `-danger`, `-border`,
  `-ring`, `-radius`, `-width`, `-rail-width`, `-font-family`, …) from the host.
- **`::part()`** hooks on structural nodes (`root`, `header`, `list`, `row`,
  `row-name`, `confirm-dialog`, `backdrop`, …).
- **Named slots**: `header`, `footer`, `empty`, `upsell`, `memories`, plus a
  **per-row slot** `row:{id}` that projects wrapper-provided row content while
  the element keeps the selection/archived/animation chrome around it.

The built-in default skin's token values are **derived at build time** from
react-core's canonical theme (`packages/react-core/src/v2/styles/globals.css`)
by `scripts/generate-tokens.ts`, which writes the checked-in
`src/threads-drawer/generated-tokens.ts`. Run `pnpm run gen:tokens` to regenerate;
`generated-tokens.test.ts` fails if the checked-in values drift from react-core.

## Host layout (reserving the drawer column)

On desktop the drawer is an in-flow column (its default width is `320px`, set via
`--cpk-drawer-width`); below the mobile breakpoint it becomes an off-canvas
overlay. Host pages that place the drawer beside their content need to reserve
that column and collapse it on mobile — off the SAME width and breakpoint the
element itself uses, not hand-copied literals.

Two surfaces expose these values:

- **`@copilotkit/web-components/threads-drawer/layout.css`** — an optional,
  importable stylesheet. It sets a default `:root { --cpk-drawer-width: 320px }`
  and ships two helper classes:

  ```tsx
  import "@copilotkit/web-components/threads-drawer/layout.css";

  <div className="copilotkit-threads-layout">
    <CopilotThreadsDrawer />
    <div className="copilotkit-threads-main">…your chat + content…</div>
  </div>;
  ```

  `copilotkit-threads-layout` reserves the `--cpk-drawer-width` column and
  collapses to a single track on mobile; `copilotkit-threads-main` pins the
  content to the second track (so the client-only drawer mounting after
  hydration causes no layout shift). Both compose with your own classes.

- **`@copilotkit/web-components/threads-drawer/layout-constants`** — the same
  values as JS constants (`DRAWER_DEFAULT_WIDTH`, `DRAWER_DEFAULT_WIDTH_PX`,
  `MOBILE_BREAKPOINT_PX`, `MOBILE_MAX_WIDTH_PX`, `MOBILE_MAX_WIDTH_QUERY`) for
  framework coordination layers that need the breakpoint in JS
  (`matchMedia(MOBILE_MAX_WIDTH_QUERY)`). This subpath is **pure** — importing it
  does not evaluate the Lit element, so it is SSR-safe.

Override `--cpk-drawer-width` (on `:root` or any ancestor) to resize the drawer
and its reserved column together.

## Mobile + a11y

Below `768px` (i.e. at/below `767px` — `MOBILE_MAX_WIDTH_QUERY`) the drawer is an
off-canvas modal overlay with backdrop, `Escape` close, scroll-lock, and a focus
trap (mobile only) that operates over the composed/flattened tree so slotted
rows are included. On desktop it is an in-flow region with collapse-to-rail —
**not** a modal (no focus trap, no scroll-lock).
