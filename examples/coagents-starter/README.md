# CoAgents Starter

This example contains a simple starter project which includes two different agents, one written in Python and one in JavaScript.

**These instructions assume you are in the `coagents-starter/` directory**

## Quick Start (Recommended)

Use the included start script for the easiest setup:

```sh
# Run Python agent + UI (default)
./start.sh

# Run JavaScript agent + UI  
./start.sh js

# Run UI only (for external agents)
./start.sh ui-only

# Install dependencies first, then run
./start.sh --install python
```

The start script will:
- ✅ Check for required environment files
- ✅ Install dependencies automatically
- ✅ Start both agent and UI services
- ✅ Provide clear status messages
- ✅ Handle graceful shutdown with Ctrl+C

**Environment Setup:** You'll need to create `.env` files with your OpenAI API key:
- `agent-py/.env` (for Python agent)
- `agent-js/.env` (for JavaScript agent) 
- `ui/.env.local` (for UI)

```
OPENAI_API_KEY=your_api_key_here
```

Once running:
- 🚀 **Python Agent:** http://localhost:8000
- 🎨 **UI:** http://localhost:3000

---

## Manual Setup (Alternative)

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

Then, run the demo:

Python

```sh
poetry run demo
```


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

If you're using the **JS** agent, uncomment the code inside the `app/api/copilotkit/route.ts`, `remoteEndpoints` action: 

```ts
// Uncomment this if you want to use LangGraph JS, make sure to 
// remove the remote action url below too.
//
// langGraphPlatformEndpoint({
//   deploymentUrl: "http://localhost:8123",
//   langsmithApiKey: process.env.LANGSMITH_API_KEY || "", // only used in LangGraph Platform deployments
//   agents: [{
//       name: 'sample_agent', 
//       description: 'A helpful LLM agent.'
//   }]
// }),
```

Make sure to comment out the other remote endpoint as this replaces it.

**Running the JS Agent:**
- Run this command to start your LangGraph server `npx @langchain/langgraph-cli dev --host localhost --port 8123`
- Run this command to connect your Copilot Cloud Tunnel to the LangGraph server `npx copilotkit@latest dev --port 8123`


## Usage

Navigate to [http://localhost:3000](http://localhost:3000).

# LangGraph Studio

Run LangGraph studio, then load the `./agent` folder into it.

Make sure to create the `.env` mentioned above first!

# Troubleshooting

## Common Issues

### "Failed to load assistants" Error
If you see this error in the browser, it means the UI can't connect to the agent:

1. **Check if agent is running:** Ensure the Python agent is running on port 8000
2. **Verify endpoint configuration:** The UI should be configured to use `langGraphPlatformEndpoint` (this is already set up correctly)
3. **Check environment files:** Make sure both `agent-py/.env` and `ui/.env.local` have valid OpenAI API keys

### Python Version Issues
The Python agent requires Python 3.11+ due to LangGraph dependencies. If you get version errors:

```sh
cd agent-py
poetry env remove --all
poetry install
```

### Port Conflicts
If you get "address already in use" errors:

1. **Port 8000:** Make sure no other application is using port 8000
2. **Port 3000:** Kill any other Next.js development servers
3. Use `lsof -ti:8000` and `lsof -ti:3000` to find processes using these ports

### Import Errors
If you see `ImportError: cannot import name 'ToolNode'`:

```sh
cd agent-py
poetry env remove --all
poetry install
python -m pip install -e .
```

### Start Script Issues
If the start script doesn't work:

1. Make it executable: `chmod +x start.sh`
2. Check your shell: The script requires bash
3. Run manually: Follow the "Manual Setup" instructions instead

## Additional Tips

1. Make sure there is no other local application server running on the 8000 port.
2. Under `/agent/greeter/demo.py`, change `0.0.0.0` to `127.0.0.1` or to `localhost`
3. If the agent fails to start, check that all dependencies are properly installed
4. For the JS agent, make sure to uncomment the correct configuration in `ui/app/api/copilotkit/route.ts`
