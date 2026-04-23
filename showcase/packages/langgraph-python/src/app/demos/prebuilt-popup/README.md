# Pre-Built: Popup

## What This Demo Shows

The pre-built `CopilotPopup` component — a floating launcher bubble that opens an overlay chat window on top of your page.

- **Floating launcher**: a bubble sits in the corner and opens a chat overlay when clicked
- **Default-open**: the popup starts open so the form factor is obvious
- **Custom placeholder**: the input placeholder is configured via the `labels` prop

## How to Interact

Click the suggestion chip, or type your own prompt. For example:

- "Say hi from the popup!"
- "What's the weather like on Mars?"
- "Give me a one-line productivity tip"

The agent replies with streaming tokens — it's the default neutral assistant, so anything conversational works.

## Technical Details

- `CopilotKit` wires the page to the runtime with `runtimeUrl="/api/copilotkit"` and `agent="prebuilt-popup"`, which resolves to the default `graph` in `src/agents/main.py` (a plain `create_agent` with no tools)
- `CopilotPopup` is rendered alongside the main content with `agentId="prebuilt-popup"`, `defaultOpen={true}`, and a `labels={{ chatInputPlaceholder: "..." }}` override
- `useConfigureSuggestions` registers a single starter chip
- This is the minimal wiring needed to drop an agentic popup onto any existing page — contrast with `prebuilt-sidebar`, which docks instead of floats
