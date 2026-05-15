# Beautiful Chat

## What This Demo Shows

A polished agentic-chat starter surface — brand-tinted background, header
copy, suggestion pills, and a rounded glass chat panel. Use this cell as a
template for embedding a CopilotKit chat into a marketing page or product
landing.

## How to Interact

Try one of the pre-baked suggestion pills, or ask:

- "What's the weather in San Francisco today?"
- "Write me a short haiku about building with AI agents."
- "Give me a one-sentence pep talk before I ship a new feature."

The agent answers via the LlamaIndex backend mounted at `/beautiful-chat`.

## Technical Details

What's happening technically:

- The frontend is a slim, brand-styled layout around a single `CopilotChat`
  component.
- `useConfigureSuggestions` registers always-on suggestion pills shown above
  the input.
- The `CopilotKit` provider points at the shared `/api/copilotkit` endpoint
  with `agent="beautiful-chat"`. The runtime route forwards that agent id
  to the LlamaIndex `beautiful_chat_router` mounted at
  `/beautiful-chat` on the agent server.
- The backend agent uses `get_ag_ui_workflow_router` with a minimal tool
  set (just `get_weather`) and a friendly system prompt — the goal is
  "pretty starter," not feature breadth.

## Differences from the LangGraph Showcase

The LangGraph version of Beautiful Chat (`langgraph-python/src/app/demos/
beautiful-chat/`) ports the full landing-page starter, including a layout
shell, canvas, generative-UI chart catalog, and a hooks tree. That breadth
is intentionally **out of scope** for the LlamaIndex parity port: this cell
demonstrates a polished CopilotChat surface, not a full reference clone of
the landing experience.

If you need richer A2UI / shared-state / MCP behavior, see the dedicated
demos: `declarative-gen-ui`, `shared-state-read-write`, `mcp-apps`.
