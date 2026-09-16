# CloudPlot

CloudPlot is a CopilotKit V2 and LangGraph demo for designing simulated AWS architectures through conversation. The workspace renders resource cards and VPC groupings while the chat renders backend tool activity and a human approval card.

CloudPlot is simulation-only. Its application and agent code import no AWS clients, call no AWS APIs, read no AWS credentials, and never create or change cloud resources. The demo manifests add no AWS-specific dependencies. Costs are fixed demo estimates rather than live AWS pricing.

## What the demo shows

- `CopilotKitProvider` and `useAgent` connect the V2 chat to shared LangGraph state.
- `useRenderTool` renders add, connect, remove, and move calls without registering duplicate frontend handlers for backend tools.
- `useHumanInTheLoop` registers `approveDeployment`. Approving or rejecting returns a tool result so the model can continue the conversation; neither decision deploys anything.
- Browser-local branch snapshots let users fork and revisit workspace alternatives.
- Quick-start prompts are ordinary product data shared by the rendered buttons and their behavior tests.

The main workspace is a responsive card layout, not a React Flow canvas. Connections are retained in agent state and shown in chat tool cards; the workspace itself groups resources by VPC.

## Run locally

Requirements:

- Node.js 20.9 or newer
- pnpm 10
- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/)
- An OpenAI API key

From the CopilotKit repository root:

```bash
pnpm install --frozen-lockfile
cd examples/showcases/cloudplot
cp .env.example .env.local
cp agent/.env.example agent/.env
# Add OPENAI_API_KEY to agent/.env.
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), then try “Build a 3-tier web application with VPC, ALB, EC2 instances, and RDS database.” The UI runs on port 3000 and the FastAPI agent runs on port 8123.

Useful commands:

```bash
pnpm dev:ui
pnpm dev:agent
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd agent
uv sync --frozen
uv run pytest
```

## Runtime architecture

```text
Browser
  CopilotKitProvider + CopilotChat + workspace cards
             |
             v
Next.js /api/copilotkit
  CopilotRuntime + LangGraphHttpAgent
             |
             v
Python FastAPI /
  LangGraphAGUIAgent + CloudPlot graph
```

The Python service uses Uvicorn and exposes AG-UI at `/`. The frontend health endpoint, `/api/health`, probes the configured agent’s `/health` endpoint with a bounded timeout and returns `503` when it cannot reach the agent.

Agent checkpoints use LangGraph `MemorySaver`, so chat-thread state lasts only for the life of one agent process. Browser branch snapshots preserve the visible workspace locally, but an agent restart loses server-side conversation checkpoints. Durable threads require an external checkpointer, which is intentionally outside this demo’s approved scope. Setting `CLOUDPLOT_REQUIRE_DURABLE_THREADS=1` makes the agent fail at startup instead of claiming unsupported durability.

## Tool flow

The model can call these backend tools:

- `add_resource`
- `connect_resources`
- `remove_resource`
- `update_resource`
- `move_to_vpc`

The browser registers render-only cards for add, connect, remove, and move. For a requested simulated deployment, the model calls the browser-owned `approveDeployment` tool. The approval card resolves to `approved` or `rejected`, and CopilotKit supplies that result to the continuation run.

Backend tool results must be structured mappings or valid JSON objects. Invalid results are logged and ignored rather than being rewritten from Python-repr text.

## Branches and persistence

Each branch has its own thread ID and browser-local workspace snapshot. Storage is read only after client hydration, so the SSR-safe zero UUID is never mounted into chat. Legacy branches without a thread ID are migrated on load, corrupt storage falls back to a fresh branch, and switching branches applies the saved workspace synchronously.

## Project structure

```text
agent/
  main.py                 LangGraph state, tools, validation, and cost model
  server.py               FastAPI/AG-UI production entrypoint and health route
  tests/                  Tests of production agent and server behavior
src/
  app/                    Next.js page, CopilotKit route, and health route
  components/             Workspace, VPC, resource, tool, and approval cards
  hooks/                  V2 agent, render-tool, HITL, and branch behavior
  lib/quickStarts.ts      Product quick-start prompt definitions
  types/                  Shared frontend state types
```

## Railway deployment

Railway no longer lets new services opt into Config as Code, so configure two
services explicitly in the Railway dashboard. Both services must use the same
merged CopilotKit revision. See Railway's
[Config as Code notice](https://docs.railway.com/config-as-code) and
[monorepo guide](https://docs.railway.com/deployments/monorepo).

| Setting           | Frontend service                                                                                                           | Agent service                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Root directory    | `/`                                                                                                                        | `/examples/showcases/cloudplot/agent`    |
| Builder           | Railpack                                                                                                                   | Dockerfile (`Dockerfile`)                |
| Build command     | `pnpm nx run cloudplot:build`                                                                                              | Dockerfile default                       |
| Start command     | `pnpm --filter cloudplot start`                                                                                            | Dockerfile default                       |
| Health-check path | `/api/health`                                                                                                              | `/health`                                |
| Restart policy    | On Failure, 5 retries                                                                                                      | On Failure, 5 retries                    |
| Watch paths       | `/examples/showcases/cloudplot/**`, `/packages/**`, `/package.json`, `/pnpm-lock.yaml`, `/pnpm-workspace.yaml`, `/nx.json` | `/examples/showcases/cloudplot/agent/**` |

Set these service variables in Railway (the platform supplies `PORT`):

- Frontend: `LANGGRAPH_DEPLOYMENT_URL`, `CLOUDPLOT_ACCESS_CODE`, and a long,
  random `CLOUDPLOT_SESSION_SECRET`.
- Agent: `OPENAI_API_KEY`.

The frontend must use the repository root because its `workspace:*`
CopilotKit dependencies are built from the monorepo. Point
`LANGGRAPH_DEPLOYMENT_URL` at the agent's private Railway URL. Do not configure
AWS credentials. Do not set `CLOUDPLOT_REQUIRE_DURABLE_THREADS=1` unless the
desired outcome is a fail-loud startup check. Both health checks return `503`
when required configuration or dependencies are unavailable.

## Manual live smoke

There is no Playwright claim for this two-service workflow. After starting or deploying both services:

1. Submit a quick-start prompt and confirm resources appear in the workspace and `add_resource` cards appear in chat.
2. Ask to simulate deployment, approve it, and confirm the assistant continues without claiming AWS resources were created.
3. Ask again, reject it, and confirm the assistant acknowledges the rejection.
4. Fork a branch, change its workspace, switch branches, and reload to confirm each browser snapshot is restored.
5. Stop the agent and confirm frontend `GET /api/health` returns `503`; restart it and confirm the endpoint returns `200`.

## License

MIT

Built by Mark Morgan
