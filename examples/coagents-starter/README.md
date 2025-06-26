# CoAgents Starter

This example contains a simple starter project which includes two different agents, one written in Python and one in JavaScript.

**These instructions assume you are in the `coagents-starter/` directory**

## Quick Start (Python Agent)

1. **Setup the Python agent:**

   ```sh
   cd agent-py
   poetry install
   echo "OPENAI_API_KEY=your_key_here" > .env
   ```

2. **Run the agent:**

   ```sh
   langgraph dev --no-browser --port=8000 --config=langgraph.json --host=0.0.0.0
   ```

   _If you encounter a "No checkpointer set" error:_

   ```sh
   LANGGRAPH_API=true langgraph dev --no-browser --port=8000 --config=langgraph.json --host=0.0.0.0
   ```

3. **Setup and run the UI (in a new terminal):**

   ```sh
   cd ui
   pnpm i
   echo "OPENAI_API_KEY=your_key_here" > .env
   pnpm run dev
   ```

4. **Open [http://localhost:3000](http://localhost:3000)** - The UI is already configured to connect to the Python agent running on port 8000.

## Running the Agent

First, install the backend dependencies:

### Python Agent

```sh
cd agent-py
poetry install
```

### JS Agent

```sh
cd agent-js
pnpm install
```

Then, create a `.env` file inside `./agent-py` or `./agent-js` with the following:

```
OPENAI_API_KEY=...
```

IMPORTANT:
Make sure the OpenAI API Key you provide, supports gpt-4o.

### Running the Python Agent

You have two options for running the Python agent:

**Option 1: Using LangGraph Dev Server (Recommended)**

```sh
cd agent-py
LANGGRAPH_API=true langgraph dev --no-browser --port=8000 --config=langgraph.json --host=0.0.0.0
```

**Option 2: Using Poetry (Local FastAPI)**

```sh
cd agent-py
poetry run demo
```

The agent code automatically detects which environment it's running in and handles checkpointer configuration accordingly.

## Running the UI

First, install the dependencies:

```sh
cd ./ui
pnpm i
```

Then start the client:

```sh
pnpm run dev
```

Then, create a `.env` file inside `./ui` with the following:

```
OPENAI_API_KEY=...
```

## Frontend Configuration (`route.ts`)

The UI connects to your agent via the configuration in `ui/app/api/copilotkit/route.ts`. The current setup depends on which agent and method you're using:

### For Python Agent

**If using LangGraph Dev Server (Option 1 - Recommended):**
The current `route.ts` is already configured correctly:

```ts
langGraphPlatformEndpoint({
  deploymentUrl: "http://localhost:8000",  // matches langgraph dev port
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  agents: [{ name: "sample_agent", description: "A helpful LLM agent." }],
}),
```

**If using Poetry/FastAPI (Option 2):**
Comment out the `langGraphPlatformEndpoint` and uncomment the basic endpoint:

```ts
// langGraphPlatformEndpoint({ ... }),  // Comment this out
{
  url: process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
},
```

### For JS Agent

Change the `deploymentUrl` port and uncomment as shown:

```ts
langGraphPlatformEndpoint({
  deploymentUrl: "http://localhost:8123",  // JS agent runs on port 8123
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  agents: [{ name: 'sample_agent', description: 'A helpful LLM agent.' }]
}),
```

**Running the JS Agent:**

- Run this command to start your LangGraph server `npx @langchain/langgraph-cli dev --host localhost --port 8123`
- Run this command to connect your Copilot Cloud Tunnel to the LangGraph server `npx copilotkit@latest dev --port 8123`

## Usage

Navigate to [http://localhost:3000](http://localhost:3000).

# LangGraph Studio

Run LangGraph studio, then load the `./agent` folder into it.

Make sure to create the `.env` mentioned above first!

# Troubleshooting

A few things to try if you are running into trouble:

1. **Port conflicts:** Make sure there is no other local application server running on the 8000 port.

2. **Network issues:** Under `/agent-py/sample_agent/demo.py`, change `0.0.0.0` to `127.0.0.1` or to `localhost`

3. **"No checkpointer set" error:** This happens when the agent can't determine which environment it's running in. The agent code automatically detects this, but if you encounter this error:

   - When using `langgraph dev`: Set `LANGGRAPH_API=true` before running: `LANGGRAPH_API=true langgraph dev ...`
   - When using `poetry run demo`: The agent should automatically use MemorySaver

4. **Route configuration:** Make sure your `ui/app/api/copilotkit/route.ts` matches your agent setup:
   - LangGraph dev server (port 8000) → Use `langGraphPlatformEndpoint`
   - FastAPI demo (port 8000) → Use basic endpoint with `/copilotkit` path
   - JS agent (port 8123) → Use `langGraphPlatformEndpoint` with port 8123
