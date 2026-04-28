# QA: Agentic Chat (Reasoning) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/agentic-chat-reasoning` on the dashboard host
- Agent backend is healthy (`/api/copilotkit` GET returns `langgraph_status: "reachable"`); `OPENAI_API_KEY` is set; `LANGGRAPH_DEPLOYMENT_URL` points at a deployment exposing the `reasoning_agent` graph (registered under agent name `agentic-chat-reasoning`)
- The demo overrides the `reasoningMessage` slot with a custom `ReasoningBlock` component (amber-tinted banner); it relies on `deepagents.create_deep_agent` + `gpt-4o-mini` and a system prompt that asks the model to "think step-by-step about the approach, then give a concise answer"

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/agentic-chat-reasoning`; verify the `CopilotChat` panel renders centered (max width 4xl, rounded-2xl corners) within 3s
- [ ] Verify the input field is visible with placeholder "Type a message"
- [ ] Send "Hello"; verify an assistant text response appears within 10s
- [ ] Verify at least one reasoning block (`data-testid="reasoning-block"`) renders above (or alongside) the final assistant text

### 2. Feature-Specific Checks

#### Reasoning Block — Streaming State

- [ ] Send a prompt that requires multi-step thinking (e.g. "If a train leaves Boston at 3pm going 60mph and another leaves NY at 4pm going 80mph, when do they meet? Explain your approach.")
- [ ] While the response is streaming, verify the `data-testid="reasoning-block"` element is visible with:
  - [ ] An uppercase "REASONING" pill badge (white background, purple border `#BEC2FF`)
  - [ ] A "Thinking…" label to the right of the pill (text color `#57575B`)
- [ ] Verify reasoning text accumulates inside the block (italic, whitespace-pre-wrap) as tokens stream in
- [ ] Verify the container border color is `#DBDBE5` and background tint is `#BEC2FF1A` (amber/indigo banner)

#### Reasoning Block — Completed State

- [ ] After streaming finishes, verify the label next to the REASONING pill flips from "Thinking…" to "Agent reasoning"
- [ ] Verify the reasoning content remains visible (not collapsed) and contains the agent's step-by-step rationale
- [ ] Verify a separate assistant text bubble renders the final concise answer below/after the reasoning block
- [ ] Verify the final answer is distinct from the reasoning text (not duplicated verbatim)

#### Multi-Turn Reasoning State Retention

- [ ] After the first exchange completes, send a follow-up prompt (e.g. "Now walk me through your work for 100mph and 120mph instead.")
- [ ] Verify the previous turn's `reasoning-block` remains rendered in the transcript (not cleared)
- [ ] Verify a NEW `reasoning-block` appears for the second turn
- [ ] Count the `[data-testid="reasoning-block"]` elements; verify there are at least 2 after the second response
- [ ] Send a third prompt; verify all three prior turns' reasoning blocks remain intact and render in chronological order

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user bubble, no reasoning-block, no assistant response)
- [ ] Send a ~500-character prompt; verify the reasoning block and answer both render without horizontal scroll or layout break
- [ ] With the backend stopped, send a message; verify the UI surfaces a visible error rather than hanging silently
- [ ] Open DevTools → Console; verify no uncaught errors during any flow above

## Expected Results

- Chat loads within 3 seconds; first reasoning token appears within 5s of sending
- The `reasoning-block` renders BEFORE the final assistant text (or simultaneously) — never after
- "Thinking…" label is visible during streaming and flips to "Agent reasoning" once `isRunning` settles
- Prior turns' reasoning blocks persist across new messages (no clearing)
- No UI layout breaks, no flash of unstyled content, no uncaught console errors
