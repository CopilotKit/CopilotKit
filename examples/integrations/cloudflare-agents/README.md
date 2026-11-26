# CopilotKit with Cloudflare Agents — Starter

This starter connects a [Cloudflare Agents](https://developers.cloudflare.com/agents/)
agent to a Next.js CopilotKit application through the
[AG-UI protocol](https://docs.ag-ui.com).

The agent is a Cloudflare Worker in `agent/`. It is an Agents SDK agent made
AG-UI-capable by [`@ag-ui/cloudflare-agents`](https://www.npmjs.com/package/@ag-ui/cloudflare-agents),
and the [AI SDK](https://ai-sdk.dev) does the model work. Each conversation
thread is one Durable Object, which keeps that thread's shared state.

It includes:

- shared todo state that the user and agent can edit, kept in the thread's
  Durable Object;
- charts that use backend data;
- flight cards and dynamic dashboards that use A2UI;
- a human-in-the-loop meeting picker;
- light and dark themes; and
- optional CopilotKit Intelligence threads and Channels.

## Requirements

- Node.js 22.12 or later
- An [OpenAI API key](https://platform.openai.com/api-keys)

You do not need a Cloudflare account to run it locally: `wrangler dev` runs the
Worker and its Durable Objects on your machine.

## Start the application

1. Copy the environment file:

   ```bash
   cp .env.example .env
   ```

2. Add your OpenAI API key to `.env`:

   ```plaintext
   OPENAI_API_KEY=your_openai_api_key
   ```

3. Install all dependencies:

   ```bash
   npm install
   ```

   The root `postinstall` script also installs the Worker's dependencies.

4. Start the frontend and the Worker:

   ```bash
   npm run dev
   ```

5. Open <http://localhost:3000>.

The frontend runs on port 3000. The Worker runs on port 8000 under
`wrangler dev`. To check it, open <http://localhost:8000/health>.

`wrangler dev` reads the Worker's settings (`OPENAI_API_KEY`,
`COPILOTKIT_AGENT_MODEL`, `OPENAI_BASE_URL`) from the root `.env`
(`--env-file ../.env`, see `scripts/run-agent.sh`), so set them there rather
than exporting them in your shell. The Durable Objects' local storage lives in
`agent/.wrangler/`; delete that folder to start from empty threads.

## Deploy the Worker to Cloudflare

1. Log in to Cloudflare and deploy the Worker, from `agent/`:

   ```bash
   cd agent
   npx wrangler login
   npx wrangler deploy
   ```

   `wrangler deploy` creates the Worker and its Durable Object class (the
   `migrations` in `agent/wrangler.jsonc`) and prints the Worker's URL, such as
   `https://copilotkit-cloudflare-agents-starter.<your-subdomain>.workers.dev`.
   Later deploys can run `npm run deploy:agent` from the starter root.

2. Give the Worker your OpenAI API key, as a secret:

   ```bash
   npx wrangler secret put OPENAI_API_KEY
   ```

   Set `COPILOTKIT_AGENT_MODEL` and `OPENAI_BASE_URL` the same way if you
   changed them, or add them to `vars` in `agent/wrangler.jsonc`.

3. Point the app at the deployed Worker. Set `AGENT_URL` in `.env` (or in your
   Next.js host's environment) to the URL from step 1, and start only the app:

   ```bash
   npm run dev:ui
   ```

The deployed Worker answers anyone who can reach its URL. Before you share it,
put it behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
or add your own authentication to `agent/src/index.ts`.

## Useful commands

- `npm run dev` starts the frontend and the Worker.
- `npm run dev:ui` starts only the Next.js frontend.
- `npm run dev:agent` starts only the Worker (`wrangler dev`).
- `npm run deploy:agent` deploys the Worker to Cloudflare.
- `npm run build` builds the Next.js application.
- `npm run channel` starts the optional Intelligence Channel host.
- `npm run typecheck:channel` checks the Channel host types.

## Project structure

```text
├── agent/                  # The Cloudflare Worker
│   ├── wrangler.jsonc      # Worker config: Durable Object binding + migrations
│   └── src/
│       ├── index.ts        # Routes each AG-UI thread to its Durable Object
│       ├── agent.ts        # The agent: prompt, tools, shared state
│       ├── a2ui.ts         # Flight cards and dynamic A2UI dashboards
│       └── model.ts        # The model, from COPILOTKIT_AGENT_MODEL
├── src/
│   ├── app/                # Next.js pages and CopilotKit API route
│   ├── components/         # Todo canvas, chat, and generative UI
│   └── agent.ts            # HttpAgent connection to the Worker
├── channel-host.mts        # Optional Intelligence Channel process
└── docker-compose.test.yml # Offline starter smoke stack
```

The Next.js runtime posts every run to `AGENT_URL/agents/assistant`. In the
Worker, `toThreadRequest` moves the thread id from the request into the path,
and the Agents SDK's `routeAgentRequest` hands `/agents/assistant/<thread id>`
to that thread's `Assistant` Durable Object. The path is the class name,
kebab-cased: a class `ResearchAgent` would be served at
`/agents/research-agent`.

## Optional Intelligence features

Set `CPK_INTELLIGENCE_API_KEY` to activate live thread history. To run a Slack
or Teams Channel, use `copilotkit init` or `copilotkit channels add`, then run:

```bash
npm run channel
```

## Customize the starter

Set `COPILOTKIT_AGENT_MODEL` in `.env` to choose the model, for example
`openai:gpt-6-luna`. The agent runs OpenAI models; for an OpenAI-compatible
provider, use `openai:<its model id>` and set `OPENAI_BASE_URL`.

Edit `agent/src/agent.ts` to change the prompt, tools, or shared state. A tool
that calls `this.setState()` updates the thread's state in its Durable Object
and streams it to the page. Edit files under `src/` to change the application
UI.

## License

MIT. See [LICENSE](./LICENSE).
