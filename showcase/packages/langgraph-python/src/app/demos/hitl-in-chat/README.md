# In-Chat HITL (useHumanInTheLoop — ergonomic API)

## What This Demo Shows

Human-in-the-loop flow where the agent pauses to ask the user for structured input via a UI card rendered inline in the chat.

- **Frontend-defined tool**: `book_call` is declared on the client with `useHumanInTheLoop` — the LangGraph agent (`hitl-in-chat`) sees it as a callable tool
- **Inline UI card**: the tool's `render` function shows a time-picker card with candidate slots
- **User choice flows back**: the picked slot (or cancellation) is returned to the agent via `respond(...)` as the tool result

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Book an intro call with the sales team to discuss pricing"
- "Schedule a 1:1 with Alice next week to review Q2 goals"
- "Set up a 30-minute onboarding call"

The agent calls `book_call`, the time-picker appears in chat, and once you pick a slot the agent confirms.

## Technical Details

- `useHumanInTheLoop({ name: "book_call", parameters, render })` declares a tool purely on the frontend — no backend tool code is needed
- The `render` prop receives `{ args, status, respond }`; calling `respond(result)` resolves the tool and hands the value back to the agent
- The backend agent (`src/agents/hitl_in_chat_agent.py`) has `tools=[]` — it relies entirely on the frontend-provided tool advertised via `CopilotKitMiddleware`
- `useConfigureSuggestions` seeds two starter prompts; `CopilotKit` wires `runtimeUrl="/api/copilotkit"` and `agent="hitl-in-chat"`
