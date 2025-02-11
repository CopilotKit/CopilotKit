# CoAgents Starter

This example contains a simple starter project.

**These instructions assume you are in the `coagents-starter/` directory**

## Running the Agent

First, install the backend dependencies:

### Python SDK

```sh
cd agent-py
poetry install
```

### JS-SDK

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

JS

```sh
pnpm run dev
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
2. Under `/agent/greeter/demo.py`, change `0.0.0.0` to `127.0.0.1` or to `localhost`
