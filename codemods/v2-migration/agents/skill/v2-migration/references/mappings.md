# v1 to 2.0 mappings

Every example imports from the 2.0 package roots. There is no `/v2` subpath in 2.0.

## Provider

`<CopilotKitProvider>` is the 2.0 provider. The codemod already renamed `<CopilotKit>` to it and `agent` to `agentId`. 2.0 still exports `CopilotKit` as an alias of `CopilotKitProvider`, so an import of `CopilotKit` from `@copilotkit/react-core` is valid. The alias takes the 2.0 props, so check its props the same way. Use `CopilotKitProvider` in new code. For the other v1 props:

| v1 prop                                                | 2.0                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `threadId`                                             | `<CopilotChat threadId="...">`, or wrap the chat in `<CopilotChatConfigurationProvider threadId="...">` |
| `guardrails_c`, `cloudRestrictToTopic`, `authConfig_c` | Removed. Ask the user how they want to replace them.                                                    |
| `forwardedParameters`                                  | Removed. Set model parameters on the agent.                                                             |
| `transcribeAudioUrl`, `textToSpeechUrl`                | Removed. Voice input goes through the runtime's transcription service.                                  |

## Angular runtime config

2.0 throws in production when `provideCopilotKit` gets no `runtimeUrl`, `licenseKey`, `agents`, or `selfManagedAgents`. The codemod marks these calls with a TODO. Add the runtime URL that the app uses. If the app sets it later with `updateRuntime`, also give it at startup:

```ts
import { provideCopilotKit } from "@copilotkit/angular";

export const copilotKitProviders = provideCopilotKit({
  runtimeUrl: "/api/copilotkit",
});
```

If the app has no runtime, ask the user which runtime URL to use. See [Angular: a missing runtime throws in production](https://docs.copilotkit.ai/migrate/providers-2.0#angular-a-missing-runtime-throws-in-production).

## Hooks

### `useCopilotReadable` → `useAgentContext`

```tsx
import { useAgentContext } from "@copilotkit/react-core";

function UserContext() {
  useAgentContext({
    description: "The current user",
    value: { name: "Ada" },
  });
  return null;
}
```

### `useCopilotAction` → `useFrontendTool`

`parameters` is a Zod schema in 2.0, not a `Parameter[]` list.

```tsx
import { useFrontendTool } from "@copilotkit/react-core";
import { z } from "zod";

function MyComponent() {
  useFrontendTool({
    name: "myTool",
    description: "Run my tool",
    parameters: z.object({}),
    handler: async () => "done",
  });
  return null;
}
```

A v1 action that only had a `render` and needed the user to answer becomes `useHumanInTheLoop`:

```tsx
import { useHumanInTheLoop } from "@copilotkit/react-core";
import { z } from "zod";

function Confirmation() {
  useHumanInTheLoop({
    name: "confirmAction",
    description: "Ask the user to confirm",
    parameters: z.object({}),
    render: ({ respond }) => (
      <button onClick={() => respond?.(true)}>Confirm</button>
    ),
  });
  return null;
}
```

### `useRenderToolCall` → `useRenderTool`

Registers a renderer for a tool that runs on the backend. The 2.0 hook named `useRenderToolCall` is a different, low-level API.

```tsx
import { useRenderTool } from "@copilotkit/react-core";
import { z } from "zod";

function StatusTool() {
  useRenderTool({
    name: "showStatus",
    parameters: z.object({}),
    render: ({ status, result }) => (
      <div>{status === "complete" ? result : "Running..."}</div>
    ),
  });
  return null;
}
```

### `useLangGraphInterrupt` → `useInterrupt`

```tsx
import { useInterrupt } from "@copilotkit/react-core";

function ApprovalInterrupt() {
  useInterrupt({
    render: ({ resolve }) => (
      <button onClick={() => resolve({ approved: true })}>Approve</button>
    ),
  });
  return null;
}
```

### `useCopilotChatSuggestions` → `useConfigureSuggestions`

```tsx
import { useConfigureSuggestions } from "@copilotkit/react-core";

function Suggestions() {
  useConfigureSuggestions({
    suggestions: [{ title: "Help", message: "Help me get started" }],
  });
  return null;
}
```

### `useCoAgent`, `useCoAgentStateRender`, `useCopilotChat` → `useAgent`

`useAgent` returns the agent: its messages, its state, and the methods that run it. Read https://docs.copilotkit.ai/reference/v2/hooks/useAgent and rewrite each use against it.

## Components

`CopilotChat`, `CopilotPopup`, and `CopilotSidebar` moved from `@copilotkit/react-ui` to `@copilotkit/react-core`, and their props changed. Check each prop against the component's docs page. The components add their own styles. Delete every CopilotKit stylesheet import, in JavaScript and in CSS.

```tsx
import { CopilotChat } from "@copilotkit/react-core";

function App() {
  return <CopilotChat agentId="my-agent" />;
}
```

### Angular `CopilotChatTextarea`

`CopilotChatTextarea` from `@copilotkit/angular` has no `ngAfterViewInit()` in 2.0. It measures its height after each render. The codemod deletes `super.ngAfterViewInit()` in subclasses and removes `override` from their `ngAfterViewInit`. If a subclass still calls `ngAfterViewInit()` on another instance of the text box, delete that call. See [Chat UI in 2.0](https://docs.copilotkit.ai/migrate/chat-2.0#angular-text-box) for the behavior changes in the chat input, recorder, sidebar, and previews.

## Chat labels and renderer lists

### Complete `CopilotChatLabels` objects

2.0 adds label keys, so a complete labels object fails to type-check. Spread the defaults and keep only the keys the app changes:

```ts
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/core";

export const labels: CopilotChatLabels = {
  ...CopilotChatDefaultLabels,
  chatInputPlaceholder: "Ask me anything...",
};
```

If the object is only an override, type it as `Partial<CopilotChatLabels>` instead.

### `renderToolCalls` and `renderActivityMessages` changed in place

Both are read-only arrays in 2.0. Give the setter a new list:

```tsx
import { useCopilotKit } from "@copilotkit/react-core";
import type { ReactToolCallRenderer } from "@copilotkit/react-core";

function useExtraRenderer(renderer: ReactToolCallRenderer<unknown>) {
  const { copilotkit } = useCopilotKit();
  copilotkit.setRenderToolCalls([...copilotkit.renderToolCalls, renderer]);
}
```

To add one renderer from a component, prefer `useRenderTool`.

### Angular copy buttons

`copied` on `CopilotChatUserMessageCopyButton` and `CopilotChatAssistantMessageCopyButton` is a read-only signal. The codemod marks each `.copied.set(...)` and `.copied.update(...)` with a TODO. To copy the text and show the check mark, call `handleCopy()` on the button. It copies the `content` input and shows the check mark for 2 seconds. If the app copies by its own logic, render its own button in the `copyButton` slot and keep the state in that button.

```ts
this.copyButton().handleCopy();
```

## Markdown rendering

2.0 renders assistant messages with `@copilotkit/markdown`, not Streamdown. It does streaming-safe GFM, tables, autolinks, and citations. It does not do syntax highlighting, KaTeX math, or mermaid diagrams. Docs: https://docs.copilotkit.ai/migrate/markdown-renderer

The `markdownRenderer` slot and the provider's `markdownRenderer` prop take one of these:

- a class string, which still works;
- a config object for the built-in renderer: `className`, `nodeRenderers`, `caret`, `options`, `onLinkClick`, `onCitationClick`;
- a component that takes `MarkdownRendererProps` (`{ content, isStreaming?, className? }`).

Fix each Streamdown prop that the codemod marked:

| Streamdown prop                                                                                                                                                         | 2.0                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components` (keyed by HTML tag)                                                                                                                                        | `nodeRenderers`, keyed by node type: `a` → `link`, `h1`-`h6` → `heading` (`node.level`), `pre`/`code` → `codeBlock`/`inlineCode`, `img` → `image`, `table` → `table`, `li` → `listItem` |
| `shikiTheme`                                                                                                                                                            | `nodeRenderers.codeBlock` with your highlighter, or a renderer component                                                                                                                |
| `remarkPlugins`, `rehypePlugins`, `remarkRehypeOptions`                                                                                                                 | A `react-markdown` renderer component (example below)                                                                                                                                   |
| `mermaid`, `controls`                                                                                                                                                   | A renderer component (Streamdown in the app), or delete the prop                                                                                                                        |
| `isAnimating`, `parseIncompleteMarkdown`, `mode`, `BlockComponent`, `parseMarkdownIntoBlocksFn`                                                                         | Delete the prop                                                                                                                                                                         |
| `allowedElements`, `disallowedElements`, `allowElement`, `skipHtml`, `unwrapDisallowed`, `urlTransform`, `allowedLinkPrefixes`, `allowedImagePrefixes`, `defaultOrigin` | Delete the prop. The built-in renderer escapes raw HTML and allows only safe URLs                                                                                                       |

A node renderer gets `node`, `children`, and `defaultNode`. Wrap `defaultNode` to restyle a node and keep the built-in output. If you render `node.url` yourself, it is the raw model output, and the built-in URL check does not run on it.

```tsx
import type { DefaultMarkdownRendererProps } from "@copilotkit/react-core";

// Module scope, so the value keeps its identity between renders.
const markdownRenderer: DefaultMarkdownRendererProps = {
  className: "prose",
  nodeRenderers: {
    link: ({ defaultNode }) => <span className="my-link">{defaultNode}</span>,
    codeBlock: ({ node }) => (
      <pre className="my-code">
        <code data-lang={node.info}>{node.text}</code>
      </pre>
    ),
  },
};
```

If the app needs highlighting, math, diagrams, or remark/rehype plugins, ask the user first. Then plug in a renderer component, defined at module scope:

```tsx
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MarkdownRendererProps } from "@copilotkit/react-core";

function ReactMarkdownRenderer({ content }: MarkdownRendererProps) {
  return <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>;
}

<CopilotKitProvider runtimeUrl="/api/copilotkit" markdownRenderer={ReactMarkdownRenderer}>
```

For Streamdown, install `streamdown` in the app and render `<Streamdown>{content}</Streamdown>` in the same way.

CSS that targets `[data-streamdown]` no longer matches. Search the stylesheets for `data-streamdown` and move those rules to the `nodeRenderers` output or to `className`.

Vue: delete every `useKatexStyles` import and call, including in `.vue` files. The export was removed.

Code that reads the `@copilotkit/markdown` AST (the codemod marks imports of `StreamingMarkdownAstNode`, `StreamingMarkdownNodeType`, `StreamingMarkdownNodeRendererKey`, and `VueStreamingMarkdownNodeRendererKey`):

- Add a `math` case to each exhaustive `switch (node.type)` and to each map keyed by every node type. The parser makes `math` nodes (`text`, `display`) only when the `enableMath` option is `true`.
- A task-list item (`- [x] done`) is a `list-item` node with `checked: true` or `checked: false`. Its text no longer starts with `[ ]` or `[x]`. Read `node.checked` instead of the text.

Behavior changes with no code to mark (tell the user, do not change code): Angular now uses the same renderer as React and Vue, so raw HTML in model output shows as text and a single newline is a soft break. Angular no longer installs `marked` or `dompurify`. React and Vue render task-list items as disabled checkboxes. Docs: https://docs.copilotkit.ai/migrate/markdown-renderer#rendering-changes-in-20

## Generative UI

Docs: https://docs.copilotkit.ai/migrate/generative-ui-2.0

`OpenGenerativeUIContentSchema` and `GenerateSandboxedUiArgsSchema` from `@copilotkit/vue` and `@copilotkit/angular` are Standard Schemas, not zod schemas. They have no `.parse`, `.safeParse`, `.shape`, or other zod members, and they cannot go into a zod schema. Validate with `["~standard"].validate(value)`. It returns `{ value }` or `{ issues }` and does not throw:

```ts
import { OpenGenerativeUIContentSchema } from "@copilotkit/vue";

const result = OpenGenerativeUIContentSchema["~standard"].validate(value);
if (result instanceof Promise) throw new Error("unexpected async schema");
if (result.issues) throw new Error(result.issues[0]?.message);
const content = result.value;
```

If the code composed the schema into a zod schema, write those fields in zod in the app.

```text
TODO(copilotkit-2.0): `filterCatalog` was removed with `@copilotkit/a2ui-renderer` in 2.0. To drop standard components, use `extends: [standardUI.omit(["Name"])]` in `createGenerativeUI`. To limit your own components, pass `createGenerativeUI` only the components you want. See https://docs.copilotkit.ai/generative-ui/components/standard-catalog#drop-components
```

`@copilotkit/a2ui-renderer` is gone, so `filterCatalog` is too. Find what the filtered catalog was for:

- It dropped components of the basic catalog: use `extends: [standardUI.omit(["Map", "Video"])]` in `createGenerativeUI`, with the names the filter removed. The names are typed.
- It picked some of your own components: pass `createGenerativeUI` only those components, or build two UIs that share the component definitions.
- It depended on runtime data (a predicate on user settings): build the UI once per case at module level, and pick the one to pass to `generativeUI={{ ui }}`.

See "A2UI v0.9 to generative UI" below.

Angular `CopilotA2UIRecovery` no longer exposes `lifecycle`, `retryRevealed`, `debugExposure`, `label`, `phase`, `failureDiagnostics`, or `retryDiagnostics`. Read the lifecycle with `readA2UILifecycleContent(content)` from `@copilotkit/angular`.

The Open Generative UI placeholder element (test id `open-generative-ui-placeholder`) was removed. While the agent generates, tests can query `open-generative-ui-progress-overlay` and `open-generative-ui-spinner`. Once generation ends, neither shows.

## A2UI v0.9 to generative UI

Docs: https://docs.copilotkit.ai/generative-ui/components/from-a2ui

2.0 has no A2UI v0.9 client: the `a2ui` provider option, `@copilotkit/a2ui-renderer` and `@copilotkit/angular/a2ui` are gone. Generative UI (A2UI 1.0) replaces them. The codemod already did the mechanical part:

| v0.9                                                                           | 2.0                                                                                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `createCatalog(definitions, renderers, options)` (`@copilotkit/a2ui-renderer`) | `createGenerativeUI({ id, extends, components })` from `@copilotkit/react-core/generative-ui`                    |
| `createAngularCatalog(...)` (`@copilotkit/angular/a2ui`)                       | `createGenerativeUI(...)` from `@copilotkit/angular/generative-ui`                                               |
| `catalogId: "x"`                                                               | `id: "x"`                                                                                                        |
| `includeBasicCatalog: true`                                                    | `extends: [standardUI]`                                                                                          |
| `DynamicStringSchema`, `DynamicNumberSchema`, `DynamicBooleanSchema`           | `z.string()`, `z.number()`, `z.boolean()`                                                                        |
| `DynamicStringListSchema`, `ChildListSchema`                                   | `z.array(z.string())`, `childList()`                                                                             |
| `z.union([z.string(), z.object({ path: z.string() })])`                        | `z.string()`                                                                                                     |
| `children: z.array(z.string())` in a definition                                | `children: childList()`                                                                                          |
| `child: z.string()` in a definition                                            | `child: child()`                                                                                                 |
| `action: ActionSchema` (or `z.unknown()`, `z.any()`) in a definition           | `events: { action: {} }` on the entry; the component calls `action?.()`                                          |
| `{ ... } satisfies CatalogDefinitions`, `: CatalogRenderers<T>`                | Deleted                                                                                                          |
| `import { z } from "zod-v3"`                                                   | `import { z } from "zod"`                                                                                        |
| `<CopilotKitProvider a2ui={{ catalog: myCatalog }}>`                           | `<CopilotKitProvider generativeUI={{ ui: myCatalog }}>`                                                          |
| `a2ui={{}}`, `a2ui={{ catalog: basicCatalog }}`                                | Deleted. The client uses the standard catalog when the runtime enables generative UI.                            |
| `provideCopilotKit({ ..., a2ui: { catalog } })`                                | `provideCopilotKit({ ... })` and `provideGenerativeUI({ ui: catalog })` from `@copilotkit/angular/generative-ui` |
| `new CopilotRuntime({ a2ui: { agents, injectA2UITool } })`                     | `new CopilotRuntime({ generativeUI: { a2uiVersion: "0.9", agents, injectA2UITool } })`                           |
| `new CopilotRuntime({ a2ui: { enabled: false } })`                             | Deleted.                                                                                                         |

When the definitions and the renderers are in their own modules (`./definitions`, `./renderers`), the catalog reads them by name (`component: renderers.Card`, `...definitions.Card`), and each renderer gets its TODO in the renderers module.

A converted catalog looks like this. Each component keeps its old renderer under a TODO:

```tsx
import { z } from "zod";
import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/generative-ui";

export const appUI = createGenerativeUI({
  id: "acme/flights",
  extends: [standardUI],
  components: {
    // TODO(copilotkit-2.0): This was a v0.9 renderer, ...
    Airport: {
      component: ({ props }) => <strong>{props.code}</strong>,
      description: "An airport by IATA code.",
      props: z.object({ code: z.string() }),
    },
  },
});
```

The finished entry:

```tsx
function Airport({ code }: { code: string }) {
  return <strong>{code}</strong>;
}

// in components:
Airport: {
  component: Airport,
  description: "An airport by IATA code.",
  props: z.object({ code: z.string() }),
},
```

`createGenerativeUI` throws when a name comes from two places. The codemod already extends `standardUI.omit([...])` for the custom components that have a standard name. If you add a component with the name of a standard component (`Text`, `Button`, `Row`, ...) and the catalog has `extends: [standardUI]`, rename it, drop the standard one with `extends: [standardUI.omit(["Button"])]`, or replace only its component with `overrides: { Button: { component } }`. See https://docs.copilotkit.ai/generative-ui/components/standard-catalog#replace-a-component

### Rewrite a renderer

```text
TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
```

A v0.9 renderer got `{ props, children, dispatch }`. A 2.0 component gets its props directly. Rewrite the body:

- **Props.** `({ props }) => props.code` becomes `({ code }) => code`. Each value arrives resolved: a component never sees `{ path }`, `{ "@path" }` or `{ "@call" }`. Delete any code that resolved a binding by hand. Type the props with `GenerativeUIComponentProps<typeof appUI, "Airport">`.
- **Children.** `children(id)` and `props.children.map(...)` go. Declare `slots: { children: "multiple" }` (or `{ child: "single" }`) on the entry, and render the `children` prop: it is a React node (a Vue named slot). For references inside the props, put `child()` or `childList()` in the schema (`ChildListSchema` already became `childList()`); the component gets rendered nodes in place of the ids. Delete the old `children` union from `props` when it becomes a slot.
- **`dispatch`.** A v0.9 action becomes an event prop. Declare it on the entry, then call the prop:
  - The action should reach the agent (a v0.9 `{ name, context }` action): declare `events: { onBuy: { description: "...", parameters: z.object({ ... }) } }`. The model sets `onBuy` to `{ "event": { "name": "buy", "userMessage": "...", "context": { ... } } }`, and a call of `onBuy(args)` sends the event to the agent as a user message.
  - The action should run app code: declare `functions: { addToCart: { parameters: z.object({ productId: z.string() }) } }` on `createGenerativeUI`, and `events: { onAddToCart: {} }` on the component (an event binds to the function with its name, or the name without `on`). Register the handler in a component inside the provider with `useGenerativeUIFunction(appUI, "addToCart", (args) => ...)` (React and Vue). The component calls `await onAddToCart?.({ productId })`; the result is `{ ok: true }` or `{ ok: false, error }`.
- **Local writes** (`set(path, value)` in v0.9) become `writable: ["value"]` on the entry: the component gets a `setValue` prop.

See https://docs.copilotkit.ai/generative-ui/components/state-and-actions

```text
TODO(copilotkit-2.0): This was a v0.9 Angular component. In 2.0 it gets each prop as an input with its resolved value, child components as `GenerativeUIChildren` inputs, and an event input or a `registerGenerativeUIFunction` function replaces `dispatch` from `injectA2UIComponentContext()`. Update the component. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
```

In Angular the component stays a standalone component, and the same rules apply to its inputs:

- Each key of `props` is an input with its resolved value: `readonly code = input<string>()`. Delete `injectA2UIComponentContext()` and the reads of `dataContext`.
- A slot (`slots: { children: "multiple" }`) or a `child()` / `childList()` prop is an input of type `GenerativeUIChildren`. Render it with `CopilotGenerativeUIChildren` (`*copilotGenerativeUIChildren`). `CopilotA2UIChild` is gone.
- `dispatch(...)` becomes an event input: declare `events: { onBuy: { ... } }` and read `readonly onBuy = input<GenerativeUIEventHandler<typeof appUI, "onBuy">>()`, then call it. For app code, declare `functions` and register the handler with `registerGenerativeUIFunction` from `@copilotkit/angular/generative-ui`.
- A Custom Element entry (`{ tagName, element }`) has no 2.0 form. Wrap the element in an Angular component.

### Write a description

```text
TODO(copilotkit-2.0): Add a `description` to this component. The agent reads it to choose the component. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
```

Add `description` to the entry: one or two sentences that say what the component shows and when to use it, for example `"A flight from one airport to another, with times and price. Use one per flight."` Read the renderer and the call sites to learn its purpose. Ask the user when it is not clear.

### Imports of the removed v0.9 client

```text
TODO(copilotkit-2.0): The A2UI v0.9 client (`@copilotkit/a2ui-renderer`, `@copilotkit/angular/a2ui`) was removed in 2.0. Use generative UI from the framework's `/generative-ui` entry: `createGenerativeUI` and `standardUI` for catalogs, `GenerativeUISurface` for a surface, and `useGenerativeUIState` and `useGenerativeUIFunction` for state and actions. Then delete this import. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
```

An import from `@copilotkit/a2ui-renderer` or `@copilotkit/angular/a2ui` is left after the conversion. Replace each name, then delete the import:

| v0.9                                                           | 2.0                                                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `A2UIRenderer`, `A2UIProvider`, `CopilotA2UISurface`           | The chat renders surfaces by itself. For an area of the page, `<GenerativeUISurface id="...">` (Angular: `CopilotGenerativeUISurface`). |
| `basicCatalog`, `vueBasicCatalog`                              | `standardUI`, in `extends` of `createGenerativeUI`.                                                                                     |
| `Catalog`, `CatalogDefinitions`, `CatalogRenderers`, `PropsOf` | `GenerativeUI`, and `GenerativeUIComponentProps<typeof ui, "Name">` for the props of a component.                                       |
| `useA2UIContext`, `useA2UIState`, `useA2UIActions`             | `state` with `useGenerativeUIState`, and `functions` with `useGenerativeUIFunction`.                                                    |
| `extractSchema`                                                | `exportA2UICatalog(ui)`.                                                                                                                |
| `injectA2UIComponentContext`, `CopilotA2UIChild` (Angular)     | Inputs, and `GenerativeUIChildren` with `CopilotGenerativeUIChildren`.                                                                  |

The removed 1.x deprecations get their own TODO with the same advice:

```text
TODO(copilotkit-2.0): `createA2UICatalog` was removed in 2.0. Declare the components with `createGenerativeUI({ id, components })` from "@copilotkit/react-core/generative-ui": one entry per component with `component`, `description` and `props`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
TODO(copilotkit-2.0): `useA2UIStore` was removed in 2.0. Generative UI has no A2UI store. Declare app state as `state` on `createGenerativeUI`, set it with `useGenerativeUIState(ui, key, value)` from "@copilotkit/react-core/generative-ui", and components read it as bound props. See https://docs.copilotkit.ai/generative-ui/components/state-and-actions
TODO(copilotkit-2.0): `extractA2UISchema` was removed in 2.0. Use `exportA2UICatalog(ui)` from "@copilotkit/react-core/generative-ui", with a UI from `createGenerativeUI`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
```

`useA2UIStoreSelector` gets the `useA2UIStore` advice, and `A2UIComponentDefinition`, `A2UIComponentMap`, `A2UIComponentProps`, `ComponentLoader` and `ComponentRegistration` get the `createA2UICatalog` advice.

### A catalog the codemod could not convert

```text
TODO(copilotkit-2.0): This v0.9 catalog could not be converted automatically. Rewrite it with `createGenerativeUI({ id, extends: [standardUI], components })`, one entry per component with `component`, `description` and plain `props`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
```

The call has a spread, a computed key, options other than `catalogId` and `includeBasicCatalog` (for example Angular `functions`), or both arguments are imported. Open the definitions and the renderers, and write one entry per component as in the table above. In Angular, the basic A2UI functions are part of `standardUI`; declare your own under `functions`.

### Binding and action schemas

```text
TODO(copilotkit-2.0): This v0.9 binding or action schema has no 2.0 equivalent. A bound prop takes its plain type (the engine resolves `{ "@path" }` before the component renders), and an action becomes an event that the component calls. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#bindings-and-actions
```

- `DataBindingSchema`: use the plain type of the value (`z.string()`, `z.number()`, ...). The model can still bind the prop with `{ "@path": "/x" }`.
- `ActionSchema`: delete the prop from `props`. Declare an event (`events: { onClick: { parameters: z.object({}) } }`) and call it from the component, as in "Rewrite a renderer".

Delete the import from `@copilotkit/a2ui-renderer` or `@copilotkit/angular/a2ui` when nothing uses it.

A definitions file that imports neither package (plain zod, with its own `z.union([z.string(), z.object({ path: z.string() })])` helpers) was not changed. Make its prop types plain there too.

### Provider

```text
TODO(copilotkit-2.0): The `a2ui` option was removed in 2.0. Pass `generativeUI={{ ui }}` with a UI from `createGenerativeUI`, or delete it to use the standard catalog. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#before-and-after
```

The `a2ui` value is a variable, or the provider already has `generativeUI`. Find the catalog in the value and pass it as `generativeUI={{ ui: catalog }}` (merge it into the existing `generativeUI`). If it had no catalog, or `basicCatalog` / `vueBasicCatalog`, delete `a2ui`.

```text
TODO(copilotkit-2.0): The `a2ui` option was removed in 2.0, and these options have no 1:1 equivalent: `theme` becomes the `theme` of the generative UI config (CSS variables), `onAction` becomes events or functions on the components, and `loadingComponent`, `recovery` and `includeSchema` are gone. Move what you need, then delete `a2ui`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
```

The codemod left the options it could not move in `a2ui`, so the type check points at them:

| v0.9 `a2ui` option | 2.0                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`            | `generativeUI={{ ui, theme }}` (Angular: `provideGenerativeUI({ ui, theme })`). It takes values for the `--a2ui-*` CSS variables, not a v0.9 theme object. See https://docs.copilotkit.ai/generative-ui/components/theming |
| `onAction`         | Events and functions on the components (see "Rewrite a renderer"). 2.0 has no hook that sees every action, so move each case to the component that raises it.                                                              |
| `loadingComponent` | Removed. Ask the user whether the default progress UI is fine.                                                                                                                                                             |
| `recovery`         | Removed.                                                                                                                                                                                                                   |
| `includeSchema`    | Removed. Generative UI always sends the catalog with the run.                                                                                                                                                              |

Then delete `a2ui`. In a `.vue` template, the codemod did not change `:a2ui`. Replace it with `:generativeUI="{ ui: appUI }"` by hand.

```text
TODO(copilotkit-2.0): The `a2ui` option was removed in 2.0. Add `provideGenerativeUI({ ui })` from "@copilotkit/angular/generative-ui" next to `provideCopilotKit`, with a UI from `createGenerativeUI`, and delete `a2ui`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#before-and-after
```

The `provideCopilotKit` call is not in a providers array, or `a2ui` is not an object literal. Add `provideGenerativeUI({ ui: appUI })` next to `provideCopilotKit` wherever the app collects its providers:

```ts
import type { ApplicationConfig } from "@angular/core";
import { provideCopilotKit } from "@copilotkit/angular";
import { provideGenerativeUI } from "@copilotkit/angular/generative-ui";
import { appUI } from "./app-ui";

export const appConfig: ApplicationConfig = {
  providers: [
    provideCopilotKit({ runtimeUrl: "/api/copilotkit" }),
    provideGenerativeUI({ ui: appUI }),
  ],
};
```

### Runtime

```text
TODO(copilotkit-2.0): The runtime `a2ui` option moved to `generativeUI: { a2uiVersion: "0.9", ...options }` in 2.0. The codemod could not move this one: its value is not an object literal, its `enabled` is not `true` or `false`, or `generativeUI` already sets one of its keys. Move it by hand, or delete it if it was off. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#before-and-after
```

Move the options under `generativeUI` with `a2uiVersion: "0.9"`, which keeps the v0.9 behavior for the agents:

```ts
import { CopilotRuntime } from "@copilotkit/runtime";

const runtime = new CopilotRuntime({
  agents: { shop },
  generativeUI: { a2uiVersion: "0.9", agents: ["shop"], injectA2UITool: true },
});
```

If `generativeUI` already sets a key that `a2ui` also set (for example `agents`), ask the user which value to keep. If `enabled` was `false`, delete `a2ui`. `a2uiVersion` can also be a map from agent id to version.

## Runtime

2.0 has no service adapters (`OpenAIAdapter`, `AnthropicAdapter`, ...) and no GraphQL endpoint. A model runs in a `BuiltInAgent`, and `createCopilotRuntimeHandler` serves the runtime. A v1 Next.js route:

```ts
const runtime = new CopilotRuntime();
const serviceAdapter = new OpenAIAdapter();

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
```

becomes, in `app/api/copilotkit/[[...slug]]/route.ts`:

```ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";

const runtime = new CopilotRuntime({
  agents: { default: new BuiltInAgent({ model: openaiText("gpt-5.5") }) },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
```

The codemod automatically migrates supported local Express/Hono factories, their mounts, and Next.js wrappers. Preserve the generated app-owned Express router: it keeps mount prefixes, hook request URLs, exact single-route matching, and fallthrough intact. Remaining adapter TODOs need manual handling, especially custom CORS callbacks or implicit header reflection.

For Express, mount `createCopilotNodeListener` from `@copilotkit/runtime/node` under the runtime prefix with `basePath: "/"`. For Hono, pass `c.req.raw` to `createCopilotRuntimeHandler` from `@copilotkit/runtime`. Neither factory returns a framework router. The `/express` and `/hono` subpaths and all `createCopilotEndpoint*` aliases were removed. Set `mode: "single-route"` for former single-route factories and `cors: true` to retain the old permissive default. Replace `handle(app)` and `app.fetch(request)` with direct handler calls. See [runtime HTTP handlers in 2.0](https://docs.copilotkit.ai/migrate/runtime-2.0) for CORS option changes and channel lifecycle.

`runtime.licenseChecker` is removed. Replace each read with `await runtime.getLicenseChecker()`. It returns `undefined` when the runtime does not use Intelligence. If the read is in a function that is not async, make the function async and update its callers.

```ts
const status = (await runtime.getLicenseChecker())?.getStatus();
```

`@copilotkit/runtime` requires Node.js `^20.19.3 || >=22.13.0`. If `engines.node`, `.nvmrc`, a Dockerfile, or CI pins an earlier Node.js version, tell the user. Do not change it without asking.

## Built-in Agent

`BuiltInAgent` imports from `@copilotkit/runtime/agent`, and it runs on TanStack AI. The codemod already moved the imports. The AI SDK helpers (`convertMessagesToVercelAISDKMessages`, `convertToolsToVercelAITools`, `createSafeUrlDownload`, ...) moved to `@copilotkit/runtime/agent/ai-sdk`.

`model` takes a TanStack AI text adapter, not a model string. The codemod rewrote each model string it could read:

| 1.x model string                                      | 2.0 `model`                          | Package                  | API key from                                                                                                    |
| ----------------------------------------------------- | ------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `"openai/gpt-5"`, `"openai:gpt-5"`                    | `openaiText("gpt-5")`                | `@tanstack/ai-openai`    | `OPENAI_API_KEY`                                                                                                |
| `"anthropic/claude-sonnet-4-6"`                       | `anthropicText("claude-sonnet-4-6")` | `@tanstack/ai-anthropic` | `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`)                                                                 |
| `"google/..."`, `"gemini/..."`, `"google-gemini/..."` | `geminiText("gemini-2.5-pro")`       | `@tanstack/ai-gemini`    | `GOOGLE_API_KEY`, then `GEMINI_API_KEY`                                                                         |
| `"vertex/gemini-2.5-pro"`                             | `vertexText("gemini-2.5-pro")`       | `@tanstack/ai-vertex`    | `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` (or the `GOOGLE_VERTEX_*` names), or `GOOGLE_VERTEX_API_KEY` |

Each adapter reads its key from the environment, so you do not pass it. If TypeScript rejects a model name, the adapter package does not list that model.

Install the packages the app needs. The runtime installs `@tanstack/ai`, but not the adapters:

1. Add the package from the table for each adapter the code imports.
2. Add `@tanstack/ai` only if the code imports from it, such as the `AnyTextAdapter` type below. Use a version in the runtime's range (`^1.2.0`).
3. If a `BuiltInAgent` used `mcpServers`, add `@tanstack/ai-mcp`.
4. If the code imports from `@copilotkit/runtime/agent/ai-sdk`, keep or add `ai`.
5. Remove `@ai-sdk/*` packages that the code no longer imports.

The codemod moved `maxRetries` into the `retry` option: `maxRetries: 3` became `retry: { maxRetries: 3 }`.

Fix the TODOs:

| TODO on                                                       | 2.0                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model` with a string or a variable                           | Pass an adapter from the table. For `minimax/...`, ask the user which OpenAI-compatible adapter to use.                                                                                                                |
| `model: openai("...")` (an AI SDK model)                      | Pass a TanStack adapter (`openaiText("gpt-5.5")` from `@tanstack/ai-openai`). To keep the AI SDK model, use a `type: "aisdk"` factory.                                                                                 |
| `temperature`, `maxOutputTokens`, `topP`, `topK`, `seed`, ... | Removed. Put the provider's own option names in `modelOptions`, for example `modelOptions: { temperature: 0.2 }`. Check the names in the provider docs.                                                                |
| `providerOptions`                                             | Removed. Move the options for this provider into `modelOptions`. For reasoning effort, use the `reasoning` option, for example `reasoning: { level: "high" }`.                                                         |
| `apiKey`                                                      | Removed. The adapter reads its key from the environment. To pass a key in code, use the `create*` adapter factory, such as `createOpenaiChat(model, apiKey)`.                                                          |
| `urlDownload`                                                 | Removed. The provider gets attachment URLs as they are. Delete the key, and tell the user.                                                                                                                             |
| `mcpServers`, `mcpClients`                                    | Removed. Create each client with `createMCPClient` from `@tanstack/ai-mcp` (example below). Pass the clients as `mcp: { clients: [client] }`. The agent keeps them open across runs. Close them when the server stops. |
| `resolveModel`, `classifyModelSpec`                           | Removed. Pass an adapter as `model`. To handle a model name that the client forwards, set the `resolveModel` option on the agent config (below).                                                                       |
| `BuiltInAgentModel`, `ModelSpecifier`                         | Removed. Use `AnyTextAdapter` from `@tanstack/ai`.                                                                                                                                                                     |
| `MCPClientConfig`, `MCPClientProvider`, `MCPClient`, ...      | Import the MCP client types from `@tanstack/ai-mcp`.                                                                                                                                                                   |

An agent with an adapter, a retry limit, an MCP client, and a resolver for forwarded model names:

```ts
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { anthropicText } from "@tanstack/ai-anthropic";
import { createMCPClient } from "@tanstack/ai-mcp";
import { openaiText } from "@tanstack/ai-openai";

const docs = await createMCPClient({
  transport: { type: "http", url: "https://mcp.example.com/mcp" },
});

const agent = new BuiltInAgent({
  model: anthropicText("claude-sonnet-4-6"),
  modelOptions: { temperature: 0.2 },
  retry: { maxRetries: 3 },
  mcp: { clients: [docs] },
  resolveModel: (name) =>
    name === "gpt-5.5" ? openaiText("gpt-5.5") : undefined,
});
```

If `resolveModel` returns `undefined`, the agent keeps its configured `model`.

See [Built-in Agent in 2.0](https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent).

## LangGraph

`LangGraphAgent` and `LangGraphHttpAgent` now come from `@ag-ui/langgraph`. That package does not handle CopilotKit's own LangGraph events. If the Python agent calls `copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, or `copilotkit_exit`, tell the user: those calls stop reaching the UI.

## Angular

`CopilotChatConfiguration` has no `_setOverride` in 2.0. The codemod rewrites `this._setOverride(threadId, explicit)` in a subclass to `this.setActiveThreadId(threadId, { explicit })`. A subclass that defines its own `_setOverride` gets a TODO: 2.0 does not call that method. Move its code into overrides of `setActiveThreadId` and `startNewThread`:

```ts
@Injectable()
export class AuditedChatConfiguration extends CopilotChatConfiguration {
  override setActiveThreadId(
    threadId: string,
    options?: { explicit?: boolean },
  ): void {
    console.log("thread", threadId);
    super.setActiveThreadId(threadId, options);
  }
}
```

`setActiveThreadId` and `startNewThread` now log a warning when the `threadId` option controls the thread. The call is still ignored.
