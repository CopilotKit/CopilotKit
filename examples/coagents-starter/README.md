# CoAgents Starter

This example contains a simple starter project which includes two different agents, one written in Python and one in JavaScript.

**These instructions assume you are in the `coagents-starter/` directory**

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

A few things to try if you are running into trouble:

1. Make sure there is no other local application server running on the 8000 port.
2. Under `/agent/greeter/demo.py`, change `0.0.0.0` to `127.0.0.1` or to `localhost`
