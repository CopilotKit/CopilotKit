# QA: Chat Customization (Slots) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/chat-slots` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the neutral `sample_agent` graph (registered to the `chat-slots` agent name)
- Note: this demo DOES include `data-testid` attributes on every custom slot. Use them as the primary selectors. The underlying agent is the neutral "helpful, concise assistant" (no frontend tools, no agent tools) — this demo exercises frontend slot customization only.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/chat-slots`; verify the page renders a centered chat surface (max-width 4xl, full viewport height) within 3s
- [ ] Verify the custom welcome screen is visible (`data-testid="custom-welcome-screen"`), replacing the default welcome
- [ ] Verify the custom welcome card contains ALL of the following verbatim elements:
  - a pill/badge reading "Custom Slot" (uppercase, rounded, white text on indigo/purple gradient background)
  - a heading (h1) reading "Welcome to the Slots demo"
  - body text reading "This welcome card is rendered via the `welcomeScreen` slot." (the word `welcomeScreen` is in monospace)
- [ ] Verify the welcome card wraps the default chat `input` element and a `suggestionView` row beneath it (both passed in as props by CopilotChatView)

### 2. Feature-Specific Checks

#### Welcome Screen Slot (`welcomeScreen`)

- [ ] Confirm the welcome card has a gradient background (Tailwind `from-indigo-500 to-purple-600`) with white text and a shadow — visually distinct from the default CopilotChat welcome
- [ ] Confirm NO default CopilotChat welcome heading is rendered (the custom card fully replaces it)

#### Suggestions (`useConfigureSuggestions`)

- [ ] Verify two suggestion pills render in the `suggestionView` slot beneath the input with verbatim titles:
  - "Write a sonnet"
  - "Tell me a joke"
- [ ] Click "Tell me a joke"; verify it sends the message "Tell me a short joke." and an assistant text response appears within 10s

#### Disclaimer Slot (`input.disclaimer`) — visible after first message

- [ ] After sending the first message, verify the custom disclaimer renders below the chat input (`data-testid="custom-disclaimer"`) containing:
  - a small badge reading "slot" (indigo background, lowercase bold)
  - body text "Custom disclaimer injected via `input.disclaimer`." (the phrase `input.disclaimer` is in monospace)
- [ ] Verify the default CopilotChat disclaimer text (if any) is NOT present — the custom disclaimer replaces it

#### Assistant Message Slot (`messageView.assistantMessage`)

- [ ] After the assistant response arrives, verify the assistant message is wrapped in the custom container (`data-testid="custom-assistant-message"`) with:
  - an indigo-tinted card background (`bg-indigo-50/60` in light mode)
  - an indigo border (`border-indigo-200`)
  - a small absolute-positioned "slot" badge at the top-left corner (indigo-600 background, white uppercase bold text)
- [ ] Verify the user message bubble is NOT wrapped in the custom container (user messages use the default styling)
- [ ] Send a second prompt ("Write a one-line sonnet"); verify the second assistant response is also wrapped in the `custom-assistant-message` container

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user bubble, no network request)
- [ ] Send a ~500-character message; verify it wraps within the max-w-4xl container without horizontal scroll or layout break; the custom assistant-message card grows to fit the response
- [ ] Verify DevTools → Console shows no uncaught errors or missing-prop warnings during any flow above

## Expected Results

- Chat surface renders within 3 seconds with the custom welcome card visible
- Assistant text response within 10 seconds; wrapped in the custom assistant-message slot on every turn
- All three custom slots (`welcomeScreen`, `input.disclaimer`, `messageView.assistantMessage`) replace their defaults and are visually distinguishable via their "slot" badges / gradient styling
- No UI layout breaks, no uncaught console errors
