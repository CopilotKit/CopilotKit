# Pre-Built: Sidebar

## What This Demo Shows

The pre-built `CopilotSidebar` component — a chat panel docked to the side of your page that toggles via a launcher button.

- **Drop-in sidebar**: a single component renders the full chat UI beside your main content
- **Default-open**: the sidebar starts open so the form factor is obvious at a glance
- **Suggestion chip**: a starter suggestion appears below the chat input

## How to Interact

Click the suggestion chip, or type your own prompt. For example:

- "Say hi!"
- "What can you help me with?"
- "Write a haiku about copilots"

The agent replies with streaming tokens — it's the default neutral assistant, so anything conversational works.

## Technical Details

- `CopilotKit` wires the page to the runtime with `runtimeUrl="/api/copilotkit"` and `agent="prebuilt-sidebar"`, which resolves to the default `graph` in `src/agents/main.py` (a plain `create_agent` with no tools)
- `CopilotSidebar` is rendered as a sibling of the main content, with `agentId="prebuilt-sidebar"` and `defaultOpen={true}`
- `useConfigureSuggestions` registers a single "Say hi" chip to demonstrate starter prompts
- This is the minimal wiring needed to add an agentic sidebar to an existing page — no custom chat component, no slot overrides
