# QA: Headless Chat (Simple) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/headless-simple` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the neutral `sample_agent` graph
- The demo wires `agent="headless-simple"` at `/api/copilotkit` (neutral assistant cell)
- Note: the demo source contains no `data-testid` attributes. Checks below rely on verbatim visible text, role/button selectors, and Tailwind utility-class structure

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/headless-simple`; verify the page renders within 3s with a centered card (max-width 4xl) on a `bg-gray-50` background
- [ ] Verify the custom heading "Headless Chat (Simple)" is visible (an `<h1>` — NOT a `<CopilotChat />` primitive)
- [ ] Verify the empty-state text "No messages yet. Say hi!" is rendered inside the message panel
- [ ] Verify the custom composer renders below the message panel: a `<textarea>` with placeholder "Type a message. Ask me to 'show a card about cats'." and a disabled `<button>` labeled "Send"
- [ ] Verify the Send button is disabled while the textarea is empty (attribute `disabled` present, visual `opacity-50`)

### 2. Feature-Specific Checks

#### Custom Composer (not default CopilotChat)

- [ ] Confirm there is no `.copilotKitChat`, `.copilotKitInput`, or `.copilotKitMessages` element in the DOM — the demo is built directly on `useAgent` and does not render `<CopilotChat />`
- [ ] Type "Hello" in the textarea; verify the Send button becomes enabled (no longer `disabled`) and its background is the solid blue utility `bg-blue-600`
- [ ] Press `Enter` (without Shift); verify the message submits, the textarea clears, and the user bubble appears right-aligned with `bg-blue-600 text-white` rounded styling and max-width 80%
- [ ] Type another message and press `Shift+Enter`; verify a newline is inserted inside the textarea and the message is NOT submitted

#### Send → Receive → Render (minimal round-trip)

- [ ] Send "Hi"; verify within 10s:
  - [ ] A user bubble appears (right-aligned, blue, verbatim "Hi")
  - [ ] A transient "Agent is thinking..." text indicator appears while `agent.isRunning` is true
  - [ ] An assistant bubble appears left-aligned with `bg-gray-100 text-gray-900` rounded styling, max-width 90%, containing the assistant's text response
- [ ] After the response settles, verify the "Agent is thinking..." indicator is gone (`agent.isRunning` flipped false) and the Send button re-enables when the textarea has content

#### Frontend Tool Rendering via `useComponent` (`show_card`)

- [ ] Send "Show a card about cats" (or "show a card titled Cats with a body about cats")
- [ ] Within 15s verify the assistant invokes the `show_card` frontend tool and a `ShowCard` renders inline inside the assistant bubble area with:
  - [ ] A bold title (e.g. "Cats") in `font-semibold text-gray-900`
  - [ ] A body paragraph in `text-sm text-gray-700` with `whitespace-pre-wrap`
  - [ ] The card is wrapped in a white rounded container with `border border-gray-300` and a small shadow
- [ ] Verify the tool call was routed through `copilotkit.runAgent({ agent })` (frontend tools registered via `useComponent` reach the agent) — confirm by the card rendering at all; if the route had used `agent.runAgent()` directly the card would not appear

#### Multi-Turn

- [ ] Send a second message (e.g. "Thanks!"); verify the user bubble is appended below the prior assistant content and a second assistant bubble appears without clearing or rearranging prior messages
- [ ] Verify the message list preserves chronological order (oldest at top, newest at bottom) and the empty-state "No messages yet. Say hi!" text is gone after the first send

### 3. Error Handling

- [ ] With the textarea empty or whitespace-only, confirm Enter is a no-op — no user bubble appears, no "Agent is thinking..." indicator
- [ ] While `agent.isRunning` is true (long response streaming), verify:
  - [ ] The Send button is `disabled`
  - [ ] Pressing Enter in the textarea is a no-op (the `send()` guard `if (!text || agent.isRunning) return;` blocks concurrent sends)
- [ ] Send a ~500-character message; verify the user bubble wraps within its 80% max-width without horizontal scroll and the layout does not break
- [ ] With the backend stopped, send a message; verify the promise rejection is swallowed silently (`.catch(() => {})`) and no uncaught error is surfaced in DevTools → Console, but the user bubble remains and `agent.isRunning` eventually returns false

## Expected Results

- Page loads within 3 seconds; first assistant response within 10 seconds; `show_card` renders within 15 seconds of the triggering prompt
- Custom composer (textarea + Send button) renders — no default CopilotChat DOM surfaces
- User bubbles: right-aligned, `bg-blue-600 text-white`, max-width 80%
- Assistant bubbles: left-aligned, `bg-gray-100 text-gray-900`, max-width 90%
- Frontend `useComponent` tool (`show_card`) renders inline via `useRenderToolCall` inside the assistant message
- No uncaught console errors during any flow above
