# QA: Chat Customization (CSS) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/chat-customization-css` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the neutral `sample_agent` graph
- The demo wires `agent="chat-customization-css"` at `/api/copilotkit` (neutral assistant cell)
- Note: the demo source contains no `data-testid` attributes. Checks below rely on CopilotKit built-in class names (`copilotKitChat`, `copilotKitMessages`, `copilotKitMessage`, `copilotKitUserMessage`, `copilotKitAssistantMessage`, `copilotKitInput`) scoped under the `.chat-css-demo-scope` wrapper defined in `theme.css`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/chat-customization-css`; verify the page renders within 3s with a single centered `<CopilotChat />` container inside a `.chat-css-demo-scope` wrapper (max-width 4xl, rounded corners via `rounded-2xl`)
- [ ] Verify the chat input is visible with a textarea placeholder (default CopilotKit placeholder, e.g. "Type a message")
- [ ] Send "Hello" and verify an assistant text response appears within 10s
- [ ] Verify the input clears after send and a user-message bubble is appended to the transcript

### 2. Feature-Specific Checks

#### Theme Applied On Load (CopilotKit CSS Variables)

- [ ] In DevTools, inspect the `.chat-css-demo-scope` element and verify `getComputedStyle(el).getPropertyValue('--copilot-kit-primary-color').trim()` equals `#ff006e`
- [ ] Verify `--copilot-kit-background-color` is `#fff8f0`, `--copilot-kit-secondary-color` is `#fde047`, and `--copilot-kit-separator-color` is `#ff006e`
- [ ] Verify the `.copilotKitChat` background renders the themed cream color `#fff8f0` (not the default white/neutral)

#### User Message Bubble (hot pink gradient, serif, bold)

- [ ] Send "Hi there"; locate the newly rendered `.copilotKitMessage.copilotKitUserMessage` bubble
- [ ] Verify its `background-image` computed style starts with `linear-gradient(135deg, rgb(255, 0, 110)` (i.e. `#ff006e`) and its text `color` is `rgb(255, 255, 255)`
- [ ] Verify `font-family` contains `Georgia`, `font-weight` is `700`, and `border-radius` is `22px 22px 4px 22px`
- [ ] Verify the bubble has a 2px solid border in `#ff6fa5` and a pink drop shadow (`box-shadow` includes `rgba(255, 0, 110, 0.35)`)

#### Assistant Message Bubble (amber, monospace, boxy)

- [ ] After the agent responds, locate the `.copilotKitMessage.copilotKitAssistantMessage` bubble
- [ ] Verify its `background-color` computed style is `rgb(253, 224, 71)` (i.e. `#fde047`) and text `color` is `rgb(30, 27, 75)` (i.e. `#1e1b4b`)
- [ ] Verify `font-family` contains `JetBrains Mono` / `Fira Code` / `Menlo` / `Consolas` (monospace stack)
- [ ] Verify the bubble uses a boxy shape with `border-radius: 4px 22px 22px 22px`, a `2px solid rgb(30, 27, 75)` border, and a hard offset shadow `4px 4px 0 rgb(30, 27, 75)`

#### Input Area (cream background, dashed pink border, serif)

- [ ] Verify the `.copilotKitInput` element has `background-color: rgb(254, 243, 199)` (i.e. `#fef3c7`), a `3px dashed rgb(255, 0, 110)` border, and `border-radius: 18px`
- [ ] Verify the inner `textarea` uses a `Georgia` serif font at `1.1rem`, with text color `#2c1810`
- [ ] Verify the placeholder text renders in italic `#c2185b` (type-drain the textarea to expose the placeholder)

#### Theme Persists Across Message Rounds

- [ ] Send a second message ("Tell me a joke"); wait for the assistant reply
- [ ] Verify both the new user bubble (pink gradient, serif) and the new assistant bubble (amber, monospace, boxy) retain the same computed styles as round 1 — no fallback to default CopilotKit theme between rounds
- [ ] Verify the `.copilotKitMessages` container continues to use the `Georgia` serif font family and the `#fff8f0` background through scrolling

#### Chat Functions Identically To Default

- [ ] Type a multi-line message using Shift+Enter and verify Enter submits, Shift+Enter inserts a newline (same as a default `<CopilotChat />`)
- [ ] Verify the agent's response streams token-by-token into the amber assistant bubble without the theme resetting mid-stream

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user bubble added)
- [ ] Send a ~500-character message; verify it wraps inside the pink user bubble without horizontal scroll, and the bubble still respects the hot-pink gradient + serif styling
- [ ] With the backend stopped, send a message; verify a visible error path surfaces in the UI and DevTools → Console shows no uncaught errors caused by the themed styles

## Expected Results

- Chat loads within 3 seconds; plain-text response within 10 seconds
- All eight `--copilot-kit-*` CSS variables from `theme.css` resolve on `.chat-css-demo-scope`
- User bubbles: hot pink gradient, white bold serif text, asymmetric rounded corners, 2px pink border, shadow
- Assistant bubbles: amber `#fde047` background, monospace dark text, boxy corners, 2px dark border, hard offset shadow
- Input: cream background, 3px dashed pink border, serif font, italic pink placeholder
- No flash of unstyled content between the default CopilotKit stylesheet and `theme.css`; no uncaught console errors
