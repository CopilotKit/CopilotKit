# CoAgents PraisonAI Agents

This example contains a simple starter project using PraisonAI Agents.

**These instructions assume you are in the `coagents-starter-praisonai-agents/` directory**

## Running the Agent

First, install the dependencies:

```sh
cd agent-py
poetry install
```

Then, create a `.env` file inside `./agent-py` with the following:

```
OPENAI_API_KEY=...
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

# Troubleshooting

A few things to try if you are running into trouble:

1. Make sure there is no other local application server running on the 8000 port.
2. Under `/agent-py/research/demo.py`, change `0.0.0.0` to `127.0.0.1` or to `localhost`

## About PraisonAI Agents

This example demonstrates how to integrate PraisonAI Agents with CopilotKit for real-time agent interactions. PraisonAI Agents provides a powerful framework for creating autonomous AI agents that can work together to accomplish complex tasks.

Features:
- Multi-agent coordination
- Task delegation and execution
- Real-time collaboration with users
- Extensible tool system 