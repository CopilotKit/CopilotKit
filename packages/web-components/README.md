# @copilotkit/web-components

Framework-agnostic CopilotKit web components built with [Lit](https://lit.dev).

This package promotes the CopilotKit threads drawer out of the framework forks
into a single, reusable [custom element](https://developer.mozilla.org/docs/Web/API/Web_components):
`<copilotkit-drawer>`. React, Angular, and Vue wrappers can build on top of it.

## Install

```sh
pnpm add @copilotkit/web-components lit
```

## `<copilotkit-drawer>`

A **controlled**, **framework-agnostic** threads drawer. All state flows IN as
properties/attributes; all user intent flows OUT as DOM `CustomEvent`s. The
element never mutates its own thread data — the consumer owns state.

### Register the element

```ts
import { defineCopilotkitDrawer } from "@copilotkit/web-components";

defineCopilotkitDrawer(); // idempotent
```

### Properties (inputs)

| Property         | Attribute          | Type                   | Default    | Description                                          |
| ---------------- | ------------------ | ---------------------- | ---------- | ---------------------------------------------------- |
| `threads`        | —                  | `DrawerThread[]`       | `[]`       | Thread list data.                                    |
| `activeThreadId` | `active-thread-id` | `string \| null`       | `null`     | Highlights the matching row.                         |
| `filter`         | `filter`           | `"active" \| "all"`    | `"active"` | Active hides archived threads.                       |
| `open`           | `open`             | `boolean`              | `false`    | Overlay open state (mobile/off-canvas).              |
| `collapsed`      | `collapsed`        | `boolean`              | `false`    | Desktop collapse-to-rail.                            |
| `overlay`        | `overlay`          | `boolean`              | `false`    | Render as a mobile off-canvas overlay with backdrop. |
| `licensed`       | `licensed`         | `boolean`              | `true`     | When false, an upsell view replaces the thread list. |
| `loading`        | `loading`          | `boolean`              | `false`    | Renders the loading state.                           |
| `error`          | `error`            | `string \| null`       | `null`     | Renders the error state when truthy.                 |
| `renderThread`   | —                  | `DrawerThreadRenderer` | —          | Optional per-row render hook.                        |

### Events (outputs)

All events bubble and are `composed` (cross the shadow boundary).

| Event             | `detail`                   |
| ----------------- | -------------------------- |
| `thread-selected` | `{ id: string }`           |
| `archive`         | `{ id: string }`           |
| `unarchive`       | `{ id: string }`           |
| `delete`          | `{ id: string }`           |
| `new-thread`      | `undefined`                |
| `filter-change`   | `{ filter: DrawerFilter }` |
| `open-change`     | `{ open: boolean }`        |
| `collapse-change` | `{ collapsed: boolean }`   |

`delete` is emitted only after the in-element confirm-delete flow is confirmed.

### Customization

- **Named slots:** `header`, `footer`, `empty`, `memories`. The `memories`
  region stays hidden until its slot is populated (no memory functionality is
  implemented here — the region is reserved).
- **`::part()`:** `panel`, `backdrop`, `header`, `title`, `toggle-button`,
  `new-thread`, `filters`, `filter-active`, `filter-all`, `thread-list`,
  `thread-row`, `thread-button`, `thread-name`, `thread-meta`, `row-actions`,
  `archive-button`, `unarchive-button`, `delete-button`, `confirm-delete`,
  `confirm-delete-yes`, `confirm-delete-no`, `empty`, `loading`, `error`,
  `upsell`, `upsell-cta`, `footer`, `memories`.
- **Theme tokens:** CSS custom properties prefixed `--cpk-drawer-*` (width,
  rail width, colors, radius, transition).
- **Per-row render hook:** `renderThread(thread, { active }) => TemplateResult | string`.

### Example

```html
<copilotkit-drawer id="drawer" overlay></copilotkit-drawer>
<script type="module">
  import { defineCopilotkitDrawer } from "@copilotkit/web-components";
  defineCopilotkitDrawer();

  const drawer = document.getElementById("drawer");
  drawer.threads = [{ id: "t1", name: "Welcome", archived: false }];
  drawer.addEventListener("thread-selected", (e) => {
    drawer.activeThreadId = e.detail.id;
  });
  drawer.addEventListener("delete", (e) => {
    drawer.threads = drawer.threads.filter((t) => t.id !== e.detail.id);
  });
</script>
```

## Responsive behavior

- **Desktop** (`> 768px`): in-flow drawer; `collapsed` narrows it to a rail.
- **Mobile** (`<= 768px`, set `overlay`): off-canvas overlay with a backdrop
  that does **not** push page content. Includes focus trap, `Escape` to close,
  and body scroll-lock while open.

## License

MIT
