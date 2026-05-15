# QA: Agentic Chat — LangGraph (Python)

The minimum-viable CopilotChat demo: vanilla `<CopilotChat>` wired to a
neutral helpful-assistant agent, with three starter-prompt suggestions.
No tools, no custom rendering — anything richer belongs in dedicated
demos (frontend-tools, tool-rendering, hitl-in-chat, etc.).

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check `/api/health`)

## Test Steps

### 1. Initial render

- [ ] Navigate to `/demos/agentic-chat`
- [ ] Verify the chat input renders with placeholder "Type a message..."
- [ ] Verify all three suggestion pills are visible:
  - "Write a sonnet"
  - "Tell me a joke"
  - "Is 17 prime?"

### 2. Free-form chat

- [ ] Type a basic message (e.g. "Say hello") and press Enter
- [ ] Verify the assistant streams back a text response

### 3. Suggestion pills

- [ ] Click the "Tell me a joke" pill
- [ ] Verify the message is sent and the assistant streams back a joke

### 4. Multi-turn context

- [ ] Send "My name is Alice."
- [ ] Wait for the assistant response
- [ ] Send "What name did I just give you?"
- [ ] Verify the assistant's second response contains "Alice"

### 5. Hygiene

- [ ] No console errors during normal usage
- [ ] No layout breakage with a very long input

## Expected Results

- Chat input mounts within ~3 seconds
- Assistant first-token latency is under ~5 seconds for short prompts;
  full responses complete within ~30 seconds
- Suggestion pills render alongside an empty chat and disappear once a
  conversation is in progress
