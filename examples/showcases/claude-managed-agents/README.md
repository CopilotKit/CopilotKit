# Claude Managed Agents × CopilotKit Cookbook

The deployable demo behind the
[Claude Managed Agents cookbook recipe](../../../showcase/shell-docs/src/content/docs/cookbook/claude-managed-agents.mdx).
It connects a hosted Claude Managed Agent to a CopilotKit chat over AG-UI and renders the
agent's compound-growth calculation as an interactive chart.

![The finance assistant rendering an interactive compound-growth projection](./demo.png)

This example is adapted from Anthropic's
[Claude Managed Agents × CopilotKit quickstart](https://github.com/anthropics/claude-quickstarts/tree/main/managed-agents/copilot-kit-ag-ui)
and reduced to one focused Cookbook interaction.

## What's inside

| Path                                    | What it does                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `server/src/setup.ts`                   | Provisions the hosted environment and managed agent once, then records their IDs.    |
| `server/src/index.ts`                   | Hosts the CopilotKit runtime and maps each CopilotKit thread to one managed session. |
| `server/src/requestLimits.ts`           | Restricts provider routes and applies the in-process demo traffic limits.            |
| `server/src/financialAssistantTools.ts` | Registers the financial assistant's backend tools.                                   |
| `web/src/App.tsx`                       | Renders the compact CopilotKit chat surface.                                         |
| `web/src/viz/`                          | Renders the streamed tool call as an interactive compound-growth chart.              |

## Prerequisites

- Node.js 22 or newer.
- An Anthropic Console account and API key with Claude Managed Agents access.
- An organization with 30-day data retention. The default `claude-fable-5` model is unavailable under zero data retention.

## Run locally

Install the two npm workspaces:

```bash
npm install
```

Copy the environment template and add your Anthropic API key:

```bash
cp .env.example .env
```

The setup defaults to `claude-fable-5`. To provision another supported model, set
`ANTHROPIC_MODEL` in `.env` before running setup, for example:

```text
ANTHROPIC_MODEL=claude-haiku-4-5
```

Provision the reusable environment and agent, then start the runtime and web app:

```bash
npm run setup
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and ask:

> If I invest $500/month at a 7% annual return, what will I have in 20 years?

The runtime streams the managed session over AG-UI. The agent calculates in its hosted
workspace, calls `show_growth_projection`, and CopilotKit renders the result inline. Each
CopilotKit thread maps to one managed session, so follow-up questions retain context.

## Commands

```bash
npm run setup              # provision once; re-running prints the existing IDs
npm run setup -- --force   # provision a replacement environment and agent
npm run dev                # server on :8787 and web app on :5173
npm run typecheck          # typecheck both workspaces
npm run build              # build the frontend to web/dist
npm start                  # serve the API and built frontend on one port
```

`npm run setup` writes the generated IDs to `agent-ids.json`, which is gitignored. For a
deployment without a persistent checkout, use the two values the command prints:

```text
ANTHROPIC_ENVIRONMENT_ID=env_...
ANTHROPIC_AGENT_ID=agent_...
```

`ANTHROPIC_MODEL` is provisioning-time configuration. Changing it does not modify an existing
managed agent. Run `npm run setup -- --force` with the new value, then replace both generated
agent IDs on the deployment before it can use the new model.

## Security and deployment

This is a demo, not a production deployment. The runtime endpoint has no authentication and
every message spends your Anthropic API credits.

The setup script gives the hosted environment no outbound network or package-manager access and
disables the complete built-in agent toolset. Each session receives only the narrowly scoped
`show_growth_projection` backend tool from the CopilotKit runtime.

The runtime accepts at most 256 KB per CopilotKit request and interrupts managed-agent turns
after 90 seconds. The adapter also serializes runs per thread, so a double submission cannot
drive the same managed session concurrently.

Only `POST /api/copilotkit/agent/financial-assistant/run` (with one optional trailing slash) can
start the provider-backed agent. The server rejects run aliases, unknown agents, and the unused
suggestion route before they reach the runtime. Provider-like attempts are limited to 20 per client
IP per minute before body parsing, and the process accepts 2,000 successful run requests per
24-hour window.

For a single-process deployment such as Railway:

```bash
npm install && npm run build && npm start
```

Set `ANTHROPIC_API_KEY` plus the two generated agent identity variables. Set
`ALLOWED_ORIGINS` to the deployed frontend origin. The server then requires that exact origin
on runtime requests, including when the frontend and runtime are hosted separately. It also limits
iframe parents to CopilotKit docs and local previews by default; override `FRAME_ANCESTORS` only
for another approved host. These browser controls are not user authentication because custom
clients can forge the headers.

When Railway supplies `RAILWAY_ENVIRONMENT_ID`, the per-IP limiter uses Railway's `X-Real-IP`
client header and normalizes IPv6 addresses with `express-rate-limit`. It deliberately ignores
`X-Forwarded-For` and leaves Express proxy trust disabled. A missing or malformed Railway client
header goes into one conservative shared bucket. Local and direct deployments instead use
Express's socket-derived `request.ip` and ignore both proxy headers.

Both rate-limit counters are intentionally in memory. A process restart clears them, and multiple
replicas each receive their own 2,000-start allowance. They are traffic controls, not a fixed
dollar ceiling. For a public demo, scope the API key to a dedicated, non-default
[Anthropic workspace](https://platform.claude.com/docs/en/manage-claude/workspaces) with the
desired monthly spend limit; that account-level limit is the durable cost backstop.

Do not expect setting `ANTHROPIC_MODEL` on Railway to change the deployed agent: the server uses
the provisioned agent ID at runtime. To switch models, reprovision the agent and update
`ANTHROPIC_ENVIRONMENT_ID` and `ANTHROPIC_AGENT_ID` on Railway.

The server also keeps its thread-to-session map in memory, so a restart starts fresh sessions;
that is acceptable for this demo but not a production persistence strategy.
