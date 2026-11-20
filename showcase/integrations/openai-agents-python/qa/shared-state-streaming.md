# QA: State Streaming — OpenAI Agents SDK (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/shared-state-streaming` on the dashboard host
- Agent backend is healthy (check /api/health); `OPENAI_API_KEY` is set (every model call goes through one OpenAI client; `OPENAI_BASE_URL` points it at aimock in tests)
- The agent server (`src/agent_server.py`) mounts `shared-state-streaming` at `/shared-state-streaming`, bound in `src/demo_agents/registry.py` to `shared_state_streaming_agent()` from `src/demo_agents/shared_state_streaming.py`; the page talks to it through `/api/copilotkit`
- How the document streams: the model calls the `write_document` function tool with the whole text as its `document` argument. The route is served by `DocumentStreamingAgent`, which follows the call's `TOOL_CALL_ARGS` deltas and sends the `document` argument's text so far as a `STATE_DELTA` on `/document` after each one, so the page's `agent.state.document` grows while the model is still writing. The tool body then commits the final text with `shared_state().update(document=...)`.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the shared-state-streaming demo page
- [ ] Verify the document panel (`data-testid="document-view"`) renders with a `0 chars` counter (`data-testid="document-char-count"`)
- [ ] Verify the chat input placeholder "Ask me to write something..." is visible
- [ ] Verify the empty state reads "Ask the agent to write something" and no `document-content` element is present
- [ ] Verify the "Write a short poem", "Draft an email" and "Explain quantum computing" suggestion buttons are visible

### 2. Feature-Specific Checks

#### Document Streaming

- [ ] Click "Write a short poem" (or send "Write a short poem about autumn leaves."); within 60s verify `document-content` appears and its text grows while the run is in progress (it is not pasted in one piece at the end)
- [ ] Verify the `0 chars` counter increases as the document streams
- [ ] Verify the "LIVE" badge (`data-testid="document-live-badge"`) is shown while the agent is running and disappears when the run ends
- [ ] Verify the final document text is complete (the tool body commits the full `document` argument, so it matches what the model wrote)
- [ ] Verify the assistant's chat reply is one short sentence, not a copy of the document

#### Other Suggestions

- [ ] Click "Draft an email" and verify the document panel is replaced by a polite email declining a Tuesday-afternoon meeting
- [ ] Click "Explain quantum computing" and verify a two-paragraph explanation streams into the panel

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Page loads within 3 seconds
- Document text starts appearing within 60 seconds of the prompt and grows until the run ends
- The "LIVE" badge is visible only while the agent runs
- No UI errors or broken layouts
