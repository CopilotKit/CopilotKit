# CopilotKit with AWS Strands — TypeScript Starter

This starter connects a TypeScript [AWS Strands](https://strandsagents.com/)
agent to a Next.js CopilotKit application through the
[AG-UI protocol](https://docs.ag-ui.com).

It includes:

- shared todo state that the user and agent can edit;
- charts that use backend data;
- flight cards and dynamic dashboards that use A2UI;
- a human-in-the-loop meeting picker;
- light and dark themes; and
- optional CopilotKit Intelligence threads and Channels.

## Requirements

- Node.js 20.9 or later
- An [OpenAI API key](https://platform.openai.com/api-keys)

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

   The root `postinstall` script also installs the agent dependencies.

4. Start the frontend and agent:

   ```bash
   npm run dev
   ```

5. Open <http://localhost:3000>.

The frontend runs on port 3000. The Strands agent runs on port 8000. To check
the agent, open <http://localhost:8000/health>.

## Useful commands

- `npm run dev` starts the frontend and agent.
- `npm run dev:ui` starts only the Next.js frontend.
- `npm run dev:agent` starts only the Strands agent.
- `npm run build` builds the Next.js application.
- `npm run channel` starts the optional Intelligence Channel host.
- `npm run typecheck:channel` checks the Channel host types.

## Project structure

```text
├── agent/
│   └── src/
│       ├── agent.ts        # Strands agent, tools, shared state, and A2UI
│       └── server.ts       # Express AG-UI server
├── src/
│   ├── app/                # Next.js pages and CopilotKit API route
│   ├── components/         # Todo canvas, chat, and generative UI
│   └── agent.ts            # HttpAgent connection to the Strands server
├── channel-host.mts        # Optional Intelligence Channel process
└── docker-compose.test.yml # Offline starter smoke stack
```

## Optional Intelligence features

Set `COPILOTKIT_LICENSE_TOKEN` to activate live thread history. To run a Slack
or Teams Channel, use `copilotkit init` or `copilotkit channels add`, then run:

```bash
npm run channel
```

## Customize the starter

Edit `agent/src/agent.ts` to change the model, prompt, tools, or shared state.
Edit files under `src/` to change the application UI.

## License

MIT. See [LICENSE](./LICENSE).
