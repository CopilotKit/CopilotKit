# CoAgents Research Canvas Example

Live demo: https://examples-coagents-research-canvas-ui.vercel.app/

---

## Running the Agent

**These instructions assume you are in the `coagents-research-canvas/` directory**


First, install the dependencies:

```sh
cd agent
poetry install
```

Then, create a `.env` file inside `./agent` with the following:
```
OPENAI_API_KEY=...
TAVILY_API_KEY=...
```

IMPORTANT:
Make sure the OpenAI API Key you provide, supports gpt-4o.

Then, run the demo:

```sh
poetry run demo
```

## Running the UI

First, install the dependencies:

```sh
cd ./ui
pnpm i
```

Then, create a `.env` file inside `./ui` with the following:
```
OPENAI_API_KEY=...
```

Then, run the Next.js project:

```sh
pnpm run dev
```

## Usage

Navigate to [http://localhost:3000](http://localhost:3000).


# LangGraph Studio

Run LangGraph studio, then load the `./agent` folder into it.

Make sure to create teh `.env` mentioned above first!




# Troubleshooting

A few things to try if you are running into trouble:

1. Make sure there is no other local application server running on the 8000 port.
2. Under `/agent/my_agent/demo.py`, change `0.0.0.0` to `127.0.0.1` or to `localhost`


----

# Uncommenting order

- page.tsx: CopilotKit provider

- Main.tsx: CopilotChat
    - notice also the easy styling
    - CSS customization guide: https://docs.copilotkit.ai/guides/custom-look-and-feel/customize-built-in-ui-components
    - fully headless UI is also available to complement / replace the built in components
- Ok, now we have 'chat with agent'.

- ResearchCanvas.tsx: useCoAgentState
- Now we have chat with agent + shared state, but not yet prod-grade (no streaming)
    - The problem is that the agent state updates discontinuously, between nodes


- Now go to agentic backend
    - chat.py:  copilotkit_customize_config
        - ask to make it shorter and rerun
    - Search.py:
        - copilotkit_customize_config (resources as they are written)
        - copilotkit_emit_state (build state as you go, emit it manuallly as needed)



- Human in the loop:
    - agent.py: interrupt_after