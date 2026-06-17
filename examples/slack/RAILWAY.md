# Deploying this bot on Railway

This example runs as **two services** in one Railway project, both built from
this same directory and the same Git branch:

| Service   | Process        | Inbound port | Public domain |
| --------- | -------------- | ------------ | ------------- |
| `runtime` | `runtime.ts`   | yes (`8200`) | not needed    |
| `bot`     | `app/index.ts` | none         | no            |

The `bot` connects out to Slack (Socket Mode) and/or Discord (gateway) and
POSTs to the `runtime` over Railway's **private network**. The `runtime` holds
the LLM + Linear MCP. Push to the branch → Railway rebuilds and redeploys both.

> **Prerequisite:** `@copilotkit/bot-discord` must be published to npm — this
> example depends on it by version range (`~0.0.1`), like the other
> `@copilotkit/bot*` packages. The Docker images install everything from the
> registry, so a fresh checkout builds with no monorepo context. (Until it's
> published, the `bot` image's `pnpm install` will fail to resolve it.)

The deploy files live here:

- `Dockerfile.runtime` — `node:22-slim`, installs deps, runs `pnpm run runtime`.
- `Dockerfile.bot` — `node:22-slim` **plus Chromium** (Playwright, for
  `render_chart` / `render_diagram`), runs `pnpm run start`.
- `railway.runtime.toml` / `railway.bot.toml` — point each service at its
  Dockerfile.
- `.dockerignore` — keeps `node_modules`, `.env`, and the e2e harness out of
  the build context.

## 1. Create the project and services

1. **New Project** in Railway → **Deploy from GitHub repo** → pick
   `CopilotKit/CopilotKit` and the branch you're deploying.
2. This creates the first service. In its **Settings**:
   - **Root Directory:** `examples/slack`
   - **Config-as-code / Railway Config File:** `railway.runtime.toml`
   - Rename the service to `runtime`.
3. **+ New** → **GitHub Repo** → same repo/branch → a second service. In its
   **Settings**:
   - **Root Directory:** `examples/slack`
   - **Config-as-code / Railway Config File:** `railway.bot.toml`
   - Rename it to `bot`.

> **Only rebuild on relevant changes (optional):** set each service's **Watch
> Paths** to `examples/slack/**` so unrelated monorepo pushes don't trigger a
> redeploy.

## 2. Environment variables

Set these in each service's **Variables** tab. Nothing is shared automatically
between services — set them where listed.

### `runtime` service

```
# Model (provider/model — defaults to openai/gpt-5.5). Set the matching key.
AGENT_MODEL=openai/gpt-5.5
OPENAI_API_KEY=sk-...

# Linear MCP (hosted; raw API key as bearer)
LINEAR_API_KEY=lin_api_...
LINEAR_TEAM_KEY=CPK

# Fixed so the bot's AGENT_URL is deterministic on the private network.
PORT=8200
```

### `bot` service

```
# Slack and/or Discord — set whichever platform(s) you want. The bot starts
# one adapter per platform whose secrets are present.
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
DISCORD_BOT_TOKEN=...
DISCORD_APP_ID=...
# DISCORD_GUILD_ID=...   # optional; instant slash-command registration in dev

# Where to reach the runtime over the private network. Use the runtime
# service's name + .railway.internal + the PORT you set above.
AGENT_URL=http://runtime.railway.internal:8200/api/copilotkit/agent/triage/run
```

> **Private networking:** services in the same project/environment resolve each
> other at `<service-name>.railway.internal`. The `runtime` listens on all
> interfaces (Node's default), so `runtime.railway.internal:8200` works with no
> public domain. If you renamed the runtime service, use that name in
> `AGENT_URL`.

## 3. Deploy & verify

Trigger a deploy (push, or Railway's **Deploy** button). Then:

- **runtime** logs: `[slack-runtime] listening on …` and `MCP: Linear`.
- **bot** logs: `[bot] started on: slack, discord` (or just the platform(s) you
  configured). @-mention the bot to confirm it answers.

Auto-deploy is on by default once the repo is connected — every push to the
branch rebuilds both services.

## Adding Notion later

Notion is optional (this guide is Linear-only). To add it, create a third
service from the same repo/dir running the sidecar
(`@notionhq/notion-mcp-server`), then on the **runtime** service set:

```
NOTION_TOKEN=ntn_...
NOTION_MCP_AUTH_TOKEN=<shared secret, also set on the sidecar>
NOTION_MCP_URL=http://<notion-service>.railway.internal:<port>/mcp
```
