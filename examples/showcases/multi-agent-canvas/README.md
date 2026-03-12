

<div align="center">

# Open Multi-Agent Canvas
   
![CopilotKit-Banner](https://github.com/user-attachments/assets/8167c845-0381-45d9-ad1c-83f995d48290)
</div>


![multi-agent-canvas](https://github.com/user-attachments/assets/5953a5a6-5686-4722-9477-5279b67b3dba)


Open Multi-Agent Canvas, created by [CopilotKit](https://github.com/CopilotKit/CopilotKit) is an open-source multi-agent chat interface that lets you manage multiple agents in one dynamic conversation. It's built with Next.js, LangGraph, and CopilotKit to help with travel planning, research, and general-purpose tasks through MCP servers.

## Existing Agents

Check out these awesome agents (they live in separate repositories). You can run them separately or deploy them on LangSmith:
- [CoAgents Travel Agent](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-travel/agent)
- [CoAgents AI Researcher](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-ai-researcher/agent)

Additionally, this project now includes a built-in MCP (Multi-Channel Protocol) Agent:
- **MCP Agent**: A general-purpose agent capable of handling various tasks through configurable MCP servers.

## Copilot Cloud is required to run this project: 




## Quick Start 🚀

### 1. Prerequisites
Make sure you have:
- [pnpm](https://pnpm.io/installation)

### 2. API Keys
- [Copilot Cloud](https://cloud.copilotkit.ai)

## Running the Frontend

Rename the `example.env` file in the `frontend` folder to `.env`:

```sh
NEXT_PUBLIC_CPK_PUBLIC_API_KEY=...
```

Install dependencies:

```sh
cd frontend
pnpm i
```



Need a CopilotKit API key? Get one [here](https://cloud.copilotkit.ai/).

Then, fire up the Next.js project:

```sh
pnpm run build && pnpm run start
```

## MCP Agent Setup

![mcp-demo](./agent/demo/mcp-demo.gif)

The MCP Agent allows you to connect to various MCP-compatible servers:

1. **Configuring Custom MCP Servers**:
   - Click the "MCP Servers" button in the top right of the interface
   - Add servers via the configuration panel:
     - **Standard IO**: Run commands locally (e.g., Python scripts)
     - **SSE**: Connect to external MCP-compatible servers (via Server-Sent Events)

2. **Public MCP Servers**:
   - You can connect to public MCP servers like [mcp.composio.dev](https://mcp.composio.dev/) and [mcp.run](https://www.mcp.run/)

## Running the MCP Agent Backend (Optional)

Rename the `example.env` file in the `agent` folder to `.env`:

```sh
OPENAI_API_KEY=...
LANGSMITH_API_KEY=...
```

If you want to use the included MCP Agent with the built-in math server:

```sh
cd agent
poetry install
poetry run langgraph dev --host localhost --port 8123 --no-browser
```

## Running a tunnel

Add another terminal and select Remote Endpoint.
Then select Local Development.
Once this is done, copy the command into your terminal and change the port to match the LangGraph server `8123`
![image](https://github.com/user-attachments/assets/6bf41042-9529-4470-8baf-dd076aad31a1)


## Documentation 
- [CopilotKit Docs](https://docs.copilotkit.ai/coagents)
- [LangGraph Platform Docs](https://langchain-ai.github.io/langgraph/cloud/deployment/cloud/)
- [Model Context Protocol (MCP) Docs](https://github.com/langchain-ai/langgraph/tree/main/examples/mcp)

## License
Distributed under the MIT License. See LICENSE for more info.
