# Standard components

A live demo of CopilotKit's generative UI standard components (`standardUI`
from `@copilotkit/react-core/v2/generative-ui`), exactly as they ship, with no
custom components. A real model renders the surfaces inline in the chat, and
`/catalog` shows all 69 components.

The hosted demo runs at https://standard-ui.copilotkit.ai.

The whole integration is one provider prop:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  useSingleEndpoint={false}
  generativeUI={{ ui: standardUI, transport: "markdown" }}
>
```

It builds on [`examples/v2/a2ui-markdown`](../../v2/a2ui-markdown), but uses
the published `@copilotkit/*` packages and its own lockfile, so it runs and
deploys on its own.

## Pages

- `/`: the chat. The sidebar lists example prompts that tour the components
  (a dashboard, a form, a table, a chart, a map, a checklist, live bindings,
  flip cards and an SVG drawing), each tagged with the components it is likely
  to use. Where that list is hidden (a phone, the collapsed rail, the page
  layout), the same prompts show as suggestion pills above the composer. Below
  the list sit the transport and layout settings and the integration snippet.
  A Docs button at the top right of the canvas (the chat card, the catalog
  header) goes to the generative UI components docs. The sidebar collapses to a slim
  rail (Cmd/Ctrl+B), remembered across pages; with no saved choice it starts
  collapsed between 900 and 1199px wide.
- The empty chat shows a sample answer: a prompt and the `standardUI` surface
  that answers it, rendered in the browser with no model call
  (`app/specimen-plate.tsx`), with the composer under it, pinned to the bottom
  like the chat's own input.
- `?transport=tool` switches to the `render_ui` tool transport, and
  `?layout=page` adds two surfaces outside the chat that the agent renders into
  by id.
- `/catalog`: every standard component, rendered from the operations a model
  would write, with the description and props the model sees, and a link to
  each component's docs page. It needs no model and no key. The samples in `app/catalog/shared/` are copied from
  [`showcase/shared/generative-ui-catalog`](../../../showcase/shared/generative-ui-catalog);
  keep them in sync.

A failed run (rate limit, model error) shows a notice above the transcript
instead of a blank reply.

## Run it

```bash
cd examples/showcases/standard-ui
pnpm install
cp .env.example .env.local   # set OPENAI_API_KEY
pnpm dev                     # http://localhost:3011
```

The app has its own `pnpm-workspace.yaml`, so `pnpm install` stays in this
folder instead of joining the monorepo workspace.

The default model is `openai/gpt-5.6-sol` on the OpenAI Responses API with
`reasoningEffort: "low"`. `COPILOTKIT_MODEL` and `OPENAI_REASONING_EFFORT`
change them.

## Layout rules for the agent

The standard catalog tells the model what each component is, not how a
designer would arrange several of them. Left alone, a model stacks every block
full width: three stat tiles become three long bars, and a badge or a button
stretches across its column. `app/lib/design-guide.ts` adds a few layout rules
to the agent's prompt: items of the same kind side by side in a `Grid`
(flashcards excepted: they stack one after another, like a deck), one recipe
for a stat tile, nothing stretched full width, numbers right-aligned in
tables, labels clear of an SVG drawing, and sample data instead of a question
when a prompt needs example content. Each rule names real props of the
standard components. The rules change how the model composes the components,
never how a component looks.

## Design

The CopilotKit theme: a `#dedee9` page with soft blur circles, a translucent
glass sidebar with white borders, white content cards, Plus Jakarta Sans and
Spline Sans Mono (self-hosted from `@fontsource-variable`). Page styles are
scoped to `ck-*` classes and never restyle the chat or the components.

## Hosting it safely

Every run spends the server's key, so `app/lib/limits.ts` limits the runtime
route, with the same numbers as the [A2UI Playground](../a2ui-playground):

| Limit                   | Default                        | Env                     |
| ----------------------- | ------------------------------ | ----------------------- |
| Runs per visitor IP     | burst of 6, then 12 per 10 min | `AGENT_RUNS_PER_10_MIN` |
| Runs across everyone    | 300 per hour (burst 60)        | `AGENT_RUNS_PER_HOUR`   |
| Runs across everyone    | 1000 per UTC day               | `AGENT_RUNS_PER_DAY`    |
| Requests per visitor IP | 120 per minute (burst 60)      |                         |
| Request body            | 1 MB                           |                         |
| Kill switch             | off                            | `AGENT_RUNS_PAUSED=1`   |

A run must be sent as `application/json`, so another site can't spend the key
through its visitors' browsers. Each model call is capped at 16,000 output
tokens. The counts live in memory, which is right for one instance; with more
instances the limits multiply.

The limiter keys visitors on the first `X-Forwarded-For` entry, so run it behind
a proxy that sets that header itself (Railway's edge does); behind one that
passes a client-supplied header through, the per-IP limit can be dodged.

## Deploy (Railway)

`pnpm start` listens on `$PORT`. Node >= 22 and pnpm 10 are pinned in
`package.json`. Set `OPENAI_API_KEY` and `NEXT_PUBLIC_SITE_URL` (the public
origin, used for absolute Open Graph URLs; `https://standard-ui.copilotkit.ai`
for the hosted demo) on the service, then deploy this folder from a clean tree:

```bash
mkdir -p /tmp/standard-ui-deploy
git archive --format=tar HEAD:examples/showcases/standard-ui | tar -x -C /tmp/standard-ui-deploy
railway up /tmp/standard-ui-deploy --path-as-root --service <service>
```
