# @copilotkit/channels-ui

A pure **JSX runtime + intermediate representation (IR) + cross-platform
component vocabulary** for authoring rich bot messages. No React, no agent
runtime, no Slack — `@copilotkit/channels-ui` depends on nothing in the repo
except `@copilotkit/shared` (for `StandardSchemaV1` types). That's what lets
a platform adapter (e.g. `@copilotkit/channels-slack`) translate the same UI into
Block Kit, while keeping the component layer tree-shakeable and testable in
isolation.

You author UI as JSX, it normalizes to one serializable IR (`BotNode[]`), and
behavior props (`onClick` / `onSelect` / `onSubmit`) ride along on the nodes
for the engine (`@copilotkit/channels`) to bind.

## Install

```sh
pnpm add @copilotkit/channels-ui
```

To author components as JSX, point the TypeScript JSX factory at this package
in the consuming project's `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@copilotkit/channels-ui",
  },
}
```

This package ships `@copilotkit/channels-ui/jsx-runtime` (and
`/jsx-dev-runtime`) exporting `jsx` / `jsxs` / `Fragment`. Author component
files as `.tsx`.

## Example

```tsx
import {
  Message,
  Header,
  Section,
  Actions,
  Button,
  renderToIR,
} from "@copilotkit/channels-ui";

function Greeting({ name }: { name: string }) {
  return (
    <Message>
      <Header>Hello {name}</Header>
      <Section>Pick an option — **bold** and `code` work too.</Section>
      <Actions>
        <Button
          style="primary"
          onClick={(ctx) => ctx.thread.post("you clicked!")}
        >
          Continue
        </Button>
      </Actions>
    </Message>
  );
}

const ir = renderToIR(<Greeting name="Ada" />);
// ir is BotNode[] — hand it to an adapter, or let @copilotkit/channels post it.
```

`renderToIR(ui: Renderable): BotNode[]` recursively invokes any component
function (passing its props) until only intrinsic string-typed nodes remain;
strings in children become `{ type: "text", props: { value } }`; `Fragment`
flattens its children. Components must be **pure functions of serializable
props** — same props in, same tree out — which is what makes content-stable
action binding and re-render rehydration possible in `@copilotkit/channels`.

`Renderable` also accepts a `{ raw }` escape hatch, which `renderToIR` passes
through as `{ type: "raw", props: { value } }` for adapters that want to
short-circuit to a native payload.

## Component vocabulary

Each component is a thin function returning a `BotNode` with a stable
intrinsic `type` string. An adapter maps these to native primitives.

Every component has a fully-typed prop interface (`MessageProps`,
`ButtonProps`, …, all exported), and the package ships its own `JSX` namespace
(resolved via `jsxImportSource: "@copilotkit/channels-ui"`). So JSX is statically
checked: unknown attributes, wrong prop values, and bad children are
compile-time errors — `<Section bogus={1} />` or `<Button style="nope">` won't
type-check. There are no lowercase intrinsic tags; the vocabulary is the
capitalized component set below.

| Component  | Purpose                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| `Message`  | Root container for a single posted message — `accent`, `onReaction`.       |
| `Header`   | Bold header / title row.                                                   |
| `Section`  | A block of (markdown) body text.                                           |
| `Markdown` | Explicit markdown text block.                                              |
| `Field`    | One label/value cell inside `Fields` — optional `label`.                   |
| `Fields`   | A grid of `Field`s (two-column key/value layout).                          |
| `Context`  | Small, muted secondary text (footnotes, metadata).                         |
| `Actions`  | Row container for interactive controls.                                    |
| `Button`   | Clickable button — `onClick`, `value`, `style`, or `url` (link button).    |
| `Select`   | Dropdown — `onSelect`, `placeholder`, `options: {label,value}[]`, `multi`. |
| `Input`    | Text input — `onSubmit`, `placeholder`, `multiline`, `name`.               |
| `Image`    | An image block.                                                            |
| `Divider`  | A horizontal rule.                                                         |

### Behavior props

Interactive components carry handler props typed as `ClickHandler`:

- `Button` → `onClick`
- `Select` → `onSelect`
- `Input` → `onSubmit`

`Message` also takes `onReaction`, fired when a user reacts to the posted
message (adds or removes). The first arg is the emoji; the second carries
`added`/`user`/`rawEmoji` plus a `thread` and the reacted message's
`messageRef` — the same surface an `onClick` gets, so a reaction can post new
UI, swap the message in place, or run a HITL flow:

```tsx
<Message
  onReaction={async (emoji, r) => {
    if (!r.added) return;
    if (emoji === "bug") await r.thread.post(<FileBug />); // post new UI
    if (emoji === "white_check_mark")
      await r.thread.update(r.messageRef, <Resolved />); // swap UI in place
  }}
>
  …
</Message>
```

It's durable on the same terms as a component `onClick`: when the `<Message>`
comes from a component registered via `createBot({ components: [...] })` and a
durable `store` is configured, a reaction after a restart re-renders the
component to re-derive the handler. Inline handlers (and `<Message>` used
directly) route in-process but don't survive a restart. For durable, filtered
reaction routing across _all_ messages, use `bot.onReaction(...)`.

A `ClickHandler` receives an `InteractionContext`, both generic over the
clicked control's value type:

```ts
type ClickHandler<TValue = unknown> = (
  ctx: InteractionContext<TValue>,
) => void | Promise<void>;

interface InteractionContext<TValue = unknown> {
  thread: Thread;
  message: IncomingMessage;
  action: { id: string; value?: TValue };
  values: Record<string, unknown>;
  user: PlatformUser;
  platform: string;
}
```

`Button` is generic over its `value` prop, so `ctx.action.value` is **inferred**
from `value` — `<Button value={{ confirmed: true }} onClick={(ctx) => ctx.action.value?.confirmed}>`
type-checks with no cast. `Select`/`Input` resolve the value to `string`.

The structural types `Thread`, `IncomingMessage`, `PlatformUser`,
`MessageRef`, and `ClickHandler` are declared here for handler typing only —
they're implemented at runtime by `@copilotkit/channels` and its adapters.
`@copilotkit/channels-ui` has no runtime dependency on them.

## `bind()` — the Tier-2 escape hatch

Inline `onClick` handlers are bound by content (component identity + path +
serializable props), so a handler can be re-derived after a restart by
re-rendering the component. When a handler closes over data that **can't** be
reconstructed from props, wrap it with `bind()` so the engine persists that
small payload explicitly alongside the minted action id:

```tsx
import { bind } from "@copilotkit/channels-ui";

<Button onClick={bind(handleChoice, { choiceId: "abc123" })}>Choose</Button>;
```

`bind(handler, args)` returns a tagged handler; the action registry stores
`args` so a cold-path dispatch passes them back via `ctx.action.value`. Keep
`args` small — it's the only handler-specific state that survives a restart.

## Exports

Runtime: `renderToIR`, `Fragment`, `bind`, and the vocabulary
(`Message`, `Header`, `Section`, `Markdown`, `Field`, `Fields`, `Context`,
`Actions`, `Button`, `Select`, `Input`, `Image`, `Divider`).
Types: `BotNode`, `BotChildren`, `ComponentFn`, `Renderable`, `Thread`,
`InteractionContext`, `PlatformUser`, `IncomingMessage`, `MessageRef`,
`ClickHandler`, and the per-component prop types (`MessageProps`,
`ButtonProps`, `SelectProps`, `TableProps`, `TableColumn`, …).
