# Renderers and data binding

A renderer is a React component keyed by the definition name. The Gen UI 2.0 engine calls your component with the resolved props directly; templates/catalog.ts wraps each renderer so it receives `{ props }`, inside a `display: contents` `.a2-node` element, with the `onAction` event turned into `action()`.

## Typing (templates/renderer-types.ts)

```ts
type Out<K extends keyof Definitions> = z.output<Definitions[K]["props"]>;
type ValueSetter<T> = "value" extends keyof T
  ? { setValue?: (value: NonNullable<T["value" & keyof T]>) => void }
  : unknown;

export type Props<K extends keyof Definitions> = Out<K> &
  ValueSetter<Out<K>> & { action?: () => void };
export type Renderer<K extends keyof Definitions> = (p: {
  props: Props<K>;
}) => ReactNode;
export type RendererMap<Keys extends keyof Definitions> = {
  [K in Keys]: Renderer<K>;
};
```

`z.output` is the type after the schema's transforms, so `child()` / `childList()` props are already `ReactNode`. Type each group of renderers with `RendererMap<"Stat" | "StatGroup">`, merge them into one map, and catalog.ts casts it once into `createGenerativeUI`.

While renderers are being built in parallel, fill missing names with a visible "renderer pending" component so the generative UI always builds.

## Display renderers

```tsx
Stat: ({ props }) => (
  <div className="a2-card a2-enter flex w-full min-w-0 flex-col gap-2 px-4 py-3.5">
    <span className="text-[12px] text-muted-foreground">{props.label}</span>
    <span className="text-[26px] font-semibold tabular-nums">{props.value}</span>
  </div>
),
```

Rules that held up across 54 custom components:

- Root is `w-full min-w-0`; nothing overflows horizontally at 300px.
- Data can be `undefined` or partial: a bound array is empty until its data lands, and the model sends malformed rows. Coerce with `Array.isArray(x) ? x : []`, filter malformed rows, show an empty state. Charts wrap in an error boundary that retries on new data (TanStack's treemap throws on duplicate names, sankey on cycles: dedupe and drop those first).
- Container queries (`@container`, `auto-fit` grids), not `sm:`/`md:`. The same component renders in a 600px chat bubble and a wide canvas.
- Text that might be long (KPI values the model chose) scales down instead of truncating.
- One shared token layer (`.a2-card`, `--a2-*`, chart palette vars) so every surface restyles in one place.

## Input renderers: two-way binding

A component that declares `writable: ["value"]` gets `setValue`. When the model bound `value` to `{ "@path" }`, the setter writes the surface data model at that path, and from then on the agent can no longer change that path. When the model sent a literal, the setter only changes local state. Keep your own local state too, so the control never sticks (templates/use-bound.ts):

```ts
export function useBound<T>(value: T | undefined, setValue: ((v: T) => void) | undefined, fallback: T) {
  const [local, setLocal] = useState<T>(value ?? fallback);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      if (value !== undefined) setLocal(value);
    }
  }, [value]);
  const set = useCallback((next: T) => { setLocal(next); setValue?.(next); }, [setValue]);
  return [local, set] as const;
}

Combobox: ({ props }) => {
  const [value, setValue] = useBound<string>(props.value, props.setValue, "");
  return <Picker value={value} onChange={setValue} options={props.options} />;
},
```

The template binds `value: { "@path": "/form/email" }` and seeds the data model with `{ form: { email: "" } }`. The submit button reads the same paths at click time:

```json
{
  "id": "submit",
  "component": "Button",
  "label": "Create account",
  "onClick": {
    "event": {
      "name": "signup_submit",
      "context": { "email": { "@path": "/form/email" } }
    }
  }
}
```

CopilotKit resolves the context, then starts a run with a visible user message naming the action (its first line is `event.userMessage` when the binding sets one) and the A2UI action in the envelope. The agent reads it with `envelopeToManifest(readCopilotKitUIEnvelope(input.forwardedProps)!).action`, which is `{ version: "v1.0", action: { name, surfaceId, sourceComponentId, timestamp, context } }`; values the user set also appear under `manifest.surfaces[surfaceId].dataModel`. A click while the agent is still running is not sent (`agent_busy`). The playground's `scripts/check-action.mjs` drives the signup form end to end. To verify binding in a test, read the data model, not just the DOM (the DOM keeps local state even when the data model did not change).

## Actions and children

```tsx
FlightCard: ({ props }) => (
  <Card>
    {/* ... */}
    {props.action ? <UIButton onClick={() => props.action?.()}>{props.actionLabel ?? "Select"}</UIButton> : null}
  </Card>
),

Section: ({ props }) => (
  <section>
    <h3>{props.title}</h3>
    <div className="flex flex-col gap-3">{props.children}</div>   {/* childList(): already rendered */}
  </section>
),
```

`props.action` exists only when the model bound `onAction`, so hide the button otherwise. A template child list (`children: { componentId: "row", path: "/items" }`) renders `row` once per item; inside it, bindings are relative (`{ "@path": "airline" }`) and `{ "@call": "@index" }` is the item's position.

## Theming inside CopilotChat

Two layers. The standard components read `--a2ui-*` variables from the provider's `theme` (top-level values for both modes, `dark` under a `.dark` class); see `playgroundTheme` in templates/catalog.ts. Your own components use your tokens, and the chat root (`[data-copilotkit]`) redefines `--primary`, `--background` and friends, so a primary button turned white. Re-declare your tokens on the wrapper you render surfaces in:

```css
.a2-surface-host,
.pg-canvas {
  --primary: oklch(0.72 0.17 292);
  --primary-foreground: oklch(0.16 0.02 292); /* ...all dark tokens */
}
.a2-static [data-generative-ui-chat-surface] {
  margin: 0;
  padding: 0;
  border: 0;
} /* surfaces outside the chat: no card box */
```

The per-component error box ("Couldn't display this part") uses light inline styles; replace it with `generativeUI={{ ui, errorBoundary: { fallback } }}`.
