# QA: Open Generative UI (Minimal) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `OPENAI_API_KEY` set so the PydanticAI agent can reach gpt-4.1

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/open-gen-ui`
- [ ] Verify the chat interface loads and suggestion pills render

### 2. Sandboxed UI Generation

- [ ] Click the "How a neural network works" suggestion
- [ ] Verify the agent streams an HTML/CSS payload and a sandboxed iframe
      mounts with the generated visualisation
- [ ] Verify the visualisation animates on its own (no host-side calls needed)
- [ ] Try at least one more suggestion (e.g. "Quicksort visualization") and
      verify each renders its own iframe

### 3. Error Handling

- [ ] Verify no console errors during normal usage
- [ ] Verify the iframe is sandboxed (check element in DevTools)

## Expected Results

- Runtime `openGenerativeUI` flag streams `generateSandboxedUi` tool calls
- Each response produces a new sandboxed iframe with the agent-authored scene
- Scenes loop / auto-advance without needing host functions
