# Parallel research with CopilotKit

A runnable Built-in Agent example with Parallel preconfigured for web search. Ask a topic-based question; the agent discovers sources with `web_search`, reads selected pages with `web_fetch`, and produces a cited answer. CopilotKit renders search/read progress and source links.

## Run locally

Requires Node.js 22+ and an OpenAI API key for the agent model. Parallel's Search MCP supports free anonymous use at lower rate limits; a Parallel key is optional for exploration.

```bash
cd examples/showcases/parallel-research
npm ci
cp .env.example .env.local
# Set OPENAI_API_KEY in .env.local. Optionally set PARALLEL_API_KEY.
npm run dev
```

Open [localhost:3000](http://localhost:3000) and ask:

> Find the official CopilotKit documentation on MCP connections. Read the relevant pages and explain HTTP authentication with source links.

The example uses published CopilotKit packages and its own npm lockfile, so you don't need to build the monorepo. It is intentionally outside the root pnpm workspace. `project.json` defines build/typecheck/test targets for a fully installed Nx workspace, and a dedicated CI workflow validates the standalone installation.

## Configuration and data flow

- `lib/parallel-config.ts` selects `https://search.parallel.ai/mcp` using Streamable HTTP. Parallel is the only configured web search provider in this example. Other SDK applications retain their own provider choices.
- `PARALLEL_API_KEY` is optional and stays on the server. When present, it is sent as `Authorization: Bearer …` through the HTTP transport's `options.requestInit.headers`. Use a Parallel account for production usage or higher limits.
- `OPENAI_API_KEY` is separate: it authenticates the agent's model. Change the server's `model` setting and model-provider credentials if desired.
- Queries, URLs, and task context included in tool arguments are sent to Parallel. Results return to the agent's model and are shown in chat. Do not include secrets in public-web requests.
- The prompt asks the agent to reuse a conversation session ID and cite returned sources. The example does not force a source count or fabricate citations. Tools can fail or return incomplete evidence; the UI retains partial sources and the agent is instructed to explain limitations.
- `maxSteps: 6` permits search, follow-up reading and a final answer while bounding the tool loop.

This local showcase uses an in-memory runner and a runtime route without application authentication. Before exposing it publicly, add your application's authentication and rate limits, choose persistent conversation storage, and review provider data handling. No live deployment is included.

## Verification

```bash
npm test
npm run typecheck
npm run build
# Optional live check; sends a public docs query and fetches a returned URL.
npm run test:live
```

The live check verifies the real MCP tool catalogue, search, fetch, and source-link parsing without a model key. An end-to-end model/chat check requires `OPENAI_API_KEY`.

See the [cookbook](https://docs.copilotkit.ai/cookbook/parallel), [CopilotKit MCP guide](https://docs.copilotkit.ai/mcp-servers), and [Parallel Search MCP documentation](https://docs.parallel.ai/integrations/mcp/search-mcp).
