# Generative UI example

A Next.js app where the agent renders interactive surfaces inline in the chat.
The surfaces use the standard components (`standardUI`). The provider turns
generative UI on with one prop:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  useSingleEndpoint={false}
  generativeUI={{ ui: standardUI, transport: "markdown" }}
>
```

## Setup

1. Install the dependencies. Run this command from the repo root:

   ```bash
   pnpm install
   ```

2. Build the CopilotKit packages. Run this command from the repo root:

   ```bash
   pnpm nx run-many -t build --projects=@copilotkit/react-core,@copilotkit/runtime
   ```

3. Copy the env file, then set `OPENAI_API_KEY` in `.env.local`:

   ```bash
   cp examples/v2/a2ui-markdown/.env.example examples/v2/a2ui-markdown/.env.local
   ```

## Run

Start the app with the built-in agent:

```bash
pnpm --filter @copilotkit/example-a2ui-markdown example-dev
```

Open `http://localhost:3011` and click a suggestion below the chat.

The page has two surfaces outside the chat: `dashboard` and `notes`. The first
three suggestions render into them:

1. "Dashboard on the page" fills `dashboard`.
2. "Checklist in the notes" fills `notes`.
3. "Update the dashboard" changes the dashboard in place, in a later reply.

To use the LangGraph Python agent in [`agent/`](./agent), you need `uv`. In a
second terminal, run these commands from `examples/v2/a2ui-markdown`:

```bash
pnpm install:agent
pnpm dev:agent                     # serves http://localhost:8011/copilotkit
```

Then open `http://localhost:3011/?agent=langgraph`.

## URL parameters

The links in the page header set these parameters:

| Parameter             | What it does                                                                     |
| --------------------- | -------------------------------------------------------------------------------- |
| `?transport=markdown` | The default. The agent writes the operations in ` ```a2ui ` fences in its reply. |
| `?transport=tool`     | The agent calls the `render_ui` tool. The runtime streams the surfaces.          |
| `?agent=langgraph`    | The chat talks to the LangGraph Python agent instead of the built-in agent.      |

Neither agent has code for generative UI. With the markdown transport, the
provider sends the component schema and the fence guideline as context. With
the tool transport, the runtime (`generativeUI: true` in
`app/api/copilotkit/[[...slug]]/route.ts`) gives the agent the `render_ui`
tool.

## The `/catalog` page

Open `http://localhost:3011/catalog` to see every standard component. Each
sample shows:

- The live surface.
- The description and props that the model sees.
- The operations that render the sample.

The page needs no model and no API key. A scripted agent streams the
surfaces in the browser (`app/catalog/catalog-agent.ts`). If a component has
no sample, the page names it at the top.

## The Kumo version

`http://localhost:3011/kumo` and `http://localhost:3011/kumo/catalog` show
the same example with the standard components drawn in
[Kumo](https://kumo-ui.com), Cloudflare's design system. The **UI** links in
the page header switch between the two.

The model sees exactly the standard catalog. `kumo/ui.ts` extends
`standardUI` and replaces only the React components with `overrides`, so
the prompts, both transports and the agents stay the same.
`kumo/coverage.ts` says how each of the 69 components is drawn, and
`/kumo/catalog` shows it as a tag next to each name:

| How                                | Count | Components                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kumo                               | 34    | Box (when it has a border, shadow or background), Grid, GridItem, Card, Tabs, Title, Text, Caption, Label, Bold, Italic, Underline, Strikethrough, Badge, Code, Link, Tooltip, Button, TextField, TextArea, Select, CheckBox, RadioGroup, Slider, SegmentedControl, Popover, PopoverTrigger, PopoverContent, Modal, Table, TableSection, TableRow, TableCell, Chart |
| Composed from Kumo parts           | 12    | Radio, ChoicePicker, DateTimeInput, Icon (Phosphor, Kumo's icon set), LinkCard, Citation, FollowUp, EntityCard, ImageGrid, Blockquote, ShimmerText, FlashcardFlip                                                                                                                                                                                                   |
| Base UI primitive with Kumo tokens | 2     | Divider, Form                                                                                                                                                                                                                                                                                                                                                       |
| Standard (no Kumo counterpart)     | 21    | Column, Row, Spacer, Flow, FlowItem, Carousel, CarouselItem, CarouselMediaItem, Markdown, Math, Pressable, PulseIndicator, List, ListItem, Map, Image, Favicon, Svg, Video, AudioPlayer, HtmlView                                                                                                                                                                   |

The standard components keep working on these pages: `kumo/theme.ts` sets
every `--a2ui-*` variable to a Kumo token, so they use Kumo's colors,
radii and chart palette.

Notes:

- Kumo's stylesheet is the standalone build, which has a global reset, so
  only the `/kumo` pages load it (`app/kumo/layout.tsx`).
- `kumo/kumo.css` hands heading sizes and control colors back to Kumo's
  cascade layers, which the standard components' unlayered rules would
  otherwise win over.
- `kumo/day-picker.css` is copied from Kumo's Tailwind stylesheet, because
  the standalone build of Kumo 2.16.0 leaves out the DatePicker styles.
- Charts use Kumo's ECharts `Chart` for all six chart types, with Kumo's
  categorical palette and legend.
- Icons are Phosphor. The model writes lucide names, so `kumo/icons.tsx`
  maps them; a name Phosphor does not have falls back to lucide.

Run the tests of the Kumo components with
`pnpm nx run @copilotkit/example-a2ui-markdown:test`.
