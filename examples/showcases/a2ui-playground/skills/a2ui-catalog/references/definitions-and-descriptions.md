# Definitions and descriptions

A definition is the contract the model reads and the engine enforces: a Zod object for props, one description, and optionally events and writable props. Keep definitions free of React so the agent (server) and the generative UI (client) import the same file.

## Shape helpers (templates/definitions-shared.ts)

```ts
import {
  A2UI_CHILD_LIST_MARK,
  A2UI_COMPONENT_ID_MARK,
} from "@copilotkit/shared";

export function child(description?: string) {
  // one component id
  return z
    .string()
    .min(1)
    .describe(mark(A2UI_COMPONENT_ID_MARK, description))
    .transform(toNode);
}
export function childList(description?: string) {
  // ids, or a template repeated per item
  return z
    .union([
      z.array(z.string().min(1)),
      z.object({ componentId: z.string().min(1), path: z.string().min(1) }),
    ])
    .describe(mark(A2UI_CHILD_LIST_MARK, description))
    .transform(toNode);
}
export const onAction = (description: string) => ({
  events: { onAction: { description, parameters: z.object({}).passthrough() } },
});
export const writableValue = { writable: ["value"] as const };
```

`@copilotkit/react-core/v2/generative-ui` exports `child()` and `childList()` too, but that module is client-only; these write the same marks from `@copilotkit/shared`, so the server can import the definitions.

What the Gen UI 2.0 engine does with each piece:

| In the definition             | Engine behavior                                                       | Renderer receives                                        |
| ----------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| prop built with `child()`     | renders the referenced component                                      | a React node                                             |
| prop built with `childList()` | renders each id, or the template once per item of the list at `path`  | React nodes                                              |
| `events: { onAction }`        | the model binds `{ event }` (sent to the agent) or `{ functionCall }` | a function (catalog.ts turns `onAction` into `action()`) |
| `writable: ["value"]`         | a `{ "@path" }` binding is written back on edit                       | `value` + `setValue`                                     |
| any other prop                | `{ "@path" }` and `{ "@call" }` resolved at any depth, then validated | the literal value                                        |

So a schema never mentions bindings: `data: z.array(row)` accepts `data: { "@path": "/rows" }` because the engine resolves it before your schema sees it. Function calls in data props are limited to `@index` and the built-in value functions (`formatCurrency`, `formatNumber`, `formatDate`, `formatString`, `pluralize`, `calc`, ...); app functions declared with `functions` are for `{ functionCall }` event bindings.

An event that matches no declared function needs `parameters` or `createGenerativeUI` throws; `onAction` declares an open object because the model's binding supplies the name and context.

## A real definition

```ts
Stat: def(
  "Data display",
  "One numeric KPI: label, short value (number or <10 chars like '$84k'), optional delta (e.g. '+4.2%'), caption. Not for sentences.",
  z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    delta: z.string().optional(),
    trend: z.enum(["up", "down", "flat"]).optional(),
    caption: z.string().optional(),
    tone: tone.optional(),
  }),
),
FlightCard: def("Domain", "One flight option: ...", z.object({ airline: z.string(), price: z.string(), /* ... */ actionLabel: z.string().optional() }),
  onAction("Fires when the flight is selected.")),
Combobox: def("Inputs", "Searchable dropdown for long option lists (countries, cities, timezones).",
  z.object({ label: z.string().optional(), value: z.string().optional(), options: z.array(option), placeholder: z.string().optional() }),
  writableValue),
```

`def(category, description, props, extra)` adds a `category` for the catalog UI and prompt grouping; catalog.ts passes `description`, `props`, `events` and `writable` to `createGenerativeUI`.

## Writing descriptions the model uses well

- One sentence, the job first: "Sortable, filterable table. columns [{key,label,format?}], rows are objects keyed by column key." The model picks components from these lines and nothing else.
- State the data shape inline when it is not obvious (`data [{x,y,series?}]`). Charts sharing one long-format row shape (`{ x, y, series? }`) made the composer far more reliable than per-chart shapes.
- Say what NOT to use it for once drift shows up. "Not for sentences" on `Stat` stopped the composer from putting "AAPL richer multiple" in a KPI tile.
- Units and scales: "Percent values are 0-100" (fractions rendered as 0.2%).
- Keep it short. Descriptions are serialized into every composer request.

## Leniency

Two checks stand between the model and the screen. The browser validates each operation against the catalog (unknown component, unknown or missing required prop, old-style `{"path"}` binding) and rejects the whole operation. Then, at render, the engine parses the resolved props with your Zod schema and shows "Couldn't display this part: ..." for that component on failure. Make props optional unless the component is meaningless without them, prefer `z.string()` over narrow enums for free text, and add a server-side repair pass (see dynamic-schema.md). Required props in this build: the one or two fields that carry the content (`text`, `label`, `data`).

## Standard components

`standardUI` (id `copilotkit/standard@1`) brings 69 components: layout (`Box`, `Column`, `Row`, `Grid`, `Card`, `Flow`, `Carousel`, `Tabs`, `Divider`, `Modal`, `Popover`), text (`Title`, `Text`, `Caption`, `Label`, `Badge`, `Markdown`, `Code`, `Link`), forms (`Form`, `Button`, `TextField`, `TextArea`, `Select`, `CheckBox`, `RadioGroup`, `Slider`, `SegmentedControl`, `ChoicePicker`, `DateTimeInput`), data (`Table`, `List`, `Chart`, `Map`), media (`Image`, `Icon`, `Video`, `AudioPlayer`) and a few chat helpers (`LinkCard`, `Citation`, `FollowUp`, `EntityCard`). A name may come from one place only. To restyle one, keep its props and swap its React component:

```ts
createGenerativeUI({
  id,
  extends: [standardUI],
  overrides: { Card: { component: MyCard } },
  components: {
    /* your own */
  },
});
createGenerativeUI({
  id,
  extends: [standardUI.omit(["Map"])],
  components: { Map: myMapDefinition },
}); // replace it entirely
```

The playground lays out with the standard `Column`, `Row`, `Grid` and `Card`, uses the standard form inputs, and adds 54 components of its own (KPIs, TanStack charts, MapLibre maps, domain cards, the inputs the standard set lacks).

## Scanning an existing codebase

```bash
pnpm dlx tsx skills/a2ui-catalog/scripts/scan-components.ts src/components --out a2ui-definitions.draft.ts --shared ./shared
```

It resolves each exported component's props with the TypeScript checker and emits a draft of `def(...)` calls (`children` -> `childList()`, other `ReactNode` props -> `child()`, `on*` -> `events`, `value` with `onChange` -> `writable: ["value"]`, literal unions -> enums). On shadcn's 32 files it found 110 exports; the right catalog from that is ~20 because most exports are sub-parts and many are already standard components. Group sub-parts into one agent-facing component (`Select` + `SelectTrigger` + `SelectItem` -> one `Combobox { label, value, options }`), then add the components your app actually has opinions about (domain cards, charts, maps).
