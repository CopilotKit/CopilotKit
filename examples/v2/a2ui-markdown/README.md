# A2UI markdown mode example

A Next.js app where the agent renders interactive A2UI surfaces inline, by
writing A2UI operations inside ` ```a2ui ` fences in an ordinary markdown
reply. The provider turns it on with one prop:

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false} a2ui={{ mode: "markdown" }}>
```

Two agents are wired into the runtime (`app/api/copilotkit/[[...slug]]/route.ts`):

| URL                                      | Agent                                                           |
| ---------------------------------------- | --------------------------------------------------------------- |
| `http://localhost:3011/`                 | `default`: CopilotKit's built-in agent (`BuiltInAgent`, OpenAI) |
| `http://localhost:3011/?agent=langgraph` | `langgraph`: the LangGraph Python agent in [`agent/`](./agent)  |

Neither agent has A2UI-specific code. The provider sends the standard catalog's
component schema and the fence guideline as context, and forwards
`__copilotkitA2UIMode: "markdown"` so the runtime does not apply the A2UI
middleware or the `render_a2ui` tool.

## Setup

```bash
pnpm install                       # from the repo root
cp .env.example .env.local         # set OPENAI_API_KEY
```

## Run

Built-in agent:

```bash
pnpm --filter @copilotkit/example-a2ui-markdown example-dev
```

LangGraph agent (second terminal, needs `uv`):

```bash
cd examples/v2/a2ui-markdown
pnpm install:agent
pnpm dev:agent                     # serves http://localhost:8011/copilotkit
```

Open `http://localhost:3011` (or `?agent=langgraph`) and try:

> Build me an interactive team plan estimator with a seat slider at $29/seat,
> an annual-billing checkbox, a comparison table and a request-quote form.

The surface paints while the reply is still streaming. Slider and checkbox
changes update bound text locally; pressing "Request quote" sends a visible
user message and starts a new assistant turn.

Docs: [A2UI markdown mode](https://docs.copilotkit.ai/generative-ui/a2ui/markdown-mode).
