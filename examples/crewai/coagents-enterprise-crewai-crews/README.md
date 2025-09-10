## Build AI Agents with CopilotKit + CrewAI

_Prerequisites:_

- [CopilotKit Cloud Account](https://cloud.copilotkit.ai)
- [CrewAI Enterprise Account](https://www.crewai.com/enterprise)
- [OpenAI Api Key](https://platform.openai.com/api-keys)

#### 1. Setup

- Deploy the demo crew located at `agent-py` on [Crew Enterprise](https://www.crewai.com/)
- Register your Crew in [Copilot Cloud](https://cloud.copilotkit.ai/)
- Copy `Cloud Public API Key` from Copilot Cloud

![Setup process](./assets/crew-cpk-setup.gif)

### 2. Start the Frontend

To start the frontend, navigate to the `ui` directory and run the development server:

```bash
> cd ui
> cp .env.example .env  # Copy the example env file
> # Edit the .env file with your Copilot Cloud Public API Key
> pnpm install
> pnpm run dev
```

The `.env` file should contain:

- `NEXT_PUBLIC_AGENT_NAME`: The name of your crew agent (default is `restaurant_finder_agent`)
- `NEXT_PUBLIC_CPK_PUBLIC_API_KEY`: Your Copilot Cloud Public API Key
