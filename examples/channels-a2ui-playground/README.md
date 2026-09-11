# A2UI to Slack playground

A local playground for the existing A2UI → Channels UI → Slack Block Kit
conversion. Paste a completed A2UI v0.9 surface, inspect the generated Block Kit,
and preview it with Tightknit's standalone `Renderer` component.

## Run

From the repository root, with Node 22 and the repository's pnpm version:

```sh
pnpm install --filter channels-a2ui-playground... --filter CopilotKit
pnpm exec nx run channels-a2ui-playground:dev
```

Open the URL printed by Vite. In Conductor, the server uses `CONDUCTOR_PORT`;
otherwise it uses port 5173. Override it with `--port=5174` if needed. The app
needs no Slack credentials, agent server, or API keys.

## Try it

The example selector starts with the POC's market snapshot. Its market prices
and timestamp are fixed sample data. A basic text/button example exercises data
bindings, and an unsupported-component example demonstrates diagnostics.

Edit the JSON and select **Render preview** (or press Cmd/Ctrl+Enter). The editor
accepts the POC's `render_a2ui` input shape:

```json
{
  "surfaceId": "hello",
  "components": [
    { "id": "root", "component": "Text", "text": "Hello from A2UI" }
  ],
  "data": {}
}
```

Component IDs must be unique, and one component must have the ID `root`.
Children reference other components by ID. The included catalog supports
`MarketSnapshot` and the POC's basic components; unsupported components and
invalid or incomplete surfaces produce diagnostics. This version takes a
completed surface rather than an incremental A2UI message stream.

Click **Acknowledge** in the Slack preview to log the corresponding A2UI client
action. The renderer's separate **Simulate** controls reach the same local
action mapping and are labeled separately in the log. Neither invokes an
agent. Conversion warnings describe known simplifications; the renderer's
validation report checks the resulting Block Kit payload.

## Implementation

- `src/poc/` contains the existing POC's pure catalog/lowering modules and market
  snapshot fixture, adapted to the current `@copilotkit/channels-ui` imports.
  They are local to this example until the shared A2UI bridge lands.
- `src/pipeline.ts` validates a completed surface, lowers it through that
  catalog, calls `@copilotkit/channels-slack/render`, and connects emitted button
  IDs to the original A2UI action dispatch.
- `src/App.tsx` uses
  [`@tightknitai/storybook-addon-slack-block-kit`](https://github.com/TightknitAI/storybook-addon-slack-block-kit)
  for the preview. Storybook satisfies the add-on's peer dependency; a Storybook
  server is not needed. Rendering comes from
  [`slack-blocks-to-jsx`](https://github.com/themashcodee/slack-blocks-to-jsx).

The renderer's visual output is accepted as-is. Direct button capture depends
on the pinned renderer's button class and its mapping from `action_id` to the
button's DOM `id`; the browser test covers that integration. This playground
does not emulate a Slack workspace.

## Verify

Run these commands from the repository root:

```sh
pnpm exec nx run-many -t check-format,lint,check-types,test,build -p channels-a2ui-playground
pnpm exec nx run channels-a2ui-playground:e2e
```

The browser tests start a production preview on `CONDUCTOR_PORT + 9` (or 4179).
Set `PLAYGROUND_TEST_PORT` to override the test port. They require Playwright's
Chromium installation and cover the market table, actual button clicks,
simulated actions, edited input, diagnostics, recovery, and theme switching.
