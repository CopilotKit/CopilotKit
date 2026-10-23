# QA: Chat Customization (CSS) — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/chat-customization-css` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set on Railway (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests); the agent server (`src/agent_server.py`) mounts `chat-customization-css` at `/chat-customization-css`, bound in `src/agents/registry.py` to the shared `neutral_agent()` from `src/agents/chat.py`
- The page wires `agent="chat-customization-css"` at `/api/copilotkit` and renders `<CopilotChat attachments={{ enabled: true }} />`
- Note: the demo adds no `data-testid` attributes of its own. Every visual choice lives in `src/app/demos/chat-customization-css/theme.css` (the "HALCYON" warm-paper theme), scoped to the `.chat-css-demo-scope` wrapper. Checks below rely on CopilotKit's built-in class names (`copilotKitChat`, `copilotKitMessages`, `copilotKitMessage`, `copilotKitUserMessage`, `copilotKitAssistantMessage`, `copilotKitInput`) and built-in testids (`copilot-welcome-screen`, `copilot-send-button`). The underlying agent is the neutral "helpful, concise assistant" (no tools) — this demo exercises frontend styling only.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/chat-customization-css`; verify the page renders within 3s with a single `<CopilotChat />` inside a `.chat-css-demo-scope` wrapper (full height, max-width 4xl, centered on a white page)
- [ ] Verify the chat input is visible and accepts text
- [ ] Send "Hello" and verify an assistant text response appears within 10s
- [ ] Verify the input clears after send and a user message is appended to the transcript

### 2. Feature-Specific Checks

#### Theme Applied On Load

- [ ] In DevTools, inspect `.chat-css-demo-scope` and verify `getComputedStyle(el).getPropertyValue('--halcyon-paper').trim()` equals `#f4efe6` and `--halcyon-ember` equals `#c44a1f`
- [ ] Inspect the `[data-copilotkit]` element inside the scope; verify the v2 tokens are re-pointed (for example `--primary` resolves to the ember value and `--radius` is `0px`)
- [ ] Verify the `.copilotKitChat` surface has the parchment background (`rgb(244, 239, 230)`), a 1px rule border, square corners (`border-radius: 0px`), and the `Inter Tight` sans font family
- [ ] Verify the mono masthead label "CopilotChat · Customized with CSS" is pinned at the top of the chat surface (rendered by `.copilotKitChat::before`)

#### Welcome Screen

- [ ] Before sending any message, verify the welcome heading (`[data-testid="copilot-welcome-screen"] h1`) renders in the italic `Instrument Serif` display face
- [ ] Verify a small ember "CopilotKit" eyebrow sits above the heading and a short rule sits below it

#### User Message (mono "transmission" card)

- [ ] Send "Hi there"; locate the new `.copilotKitMessage.copilotKitUserMessage`
- [ ] Verify the outer wrapper is transparent and the inner bubble uses `JetBrains Mono`, an off-white paper background, square corners, and a 2px ember left border
- [ ] Verify the text is preceded by an ember "→" marker

#### Assistant Message (editorial serif, no bubble)

- [ ] After the agent responds, locate the `.copilotKitMessage.copilotKitAssistantMessage`
- [ ] Verify it has a transparent background, the `Fraunces` serif font family, and no bubble border
- [ ] Verify a thin 1px ember rule runs down its left edge (rendered by `::before`)
- [ ] Ask for a short list or a code sample; verify list markers render in ember and code blocks render as a dark ink card with light mono text

#### Input Area and Send Button

- [ ] Verify `.copilotKitInput` has a white card background, a 1px rule border and square corners
- [ ] Focus the textarea; verify the border turns ember and an ember focus ring appears
- [ ] Verify the placeholder renders in italic muted ink
- [ ] Verify `button[data-testid="copilot-send-button"]` is a square ember chip (36px, 2px radius) rather than the default round black button, and turns muted paper when disabled

#### Theme Persists Across Rounds

- [ ] Send a second message ("Tell me a joke"); wait for the reply
- [ ] Verify the new user and assistant messages keep the same computed styles as round 1 — no fallback to the default CopilotKit look between rounds or while the reply streams

#### Chat Behaves Like the Default

- [ ] Verify Enter submits and Shift+Enter inserts a newline, as on a default `<CopilotChat />`
- [ ] Verify the attachment (add) control is present in the input toolbar (`attachments` is enabled) and styled as a ghost square that tints ember on hover

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user message added)
- [ ] Send a ~500-character message; verify it wraps inside the user card without horizontal scroll
- [ ] With the backend stopped, send a message; verify a visible error path surfaces and DevTools → Console shows no uncaught errors caused by the themed styles

## Expected Results

- Chat loads within 3 seconds; plain-text response within 10 seconds
- The HALCYON tokens resolve on `.chat-css-demo-scope`, and the v2 token overrides resolve on `[data-copilotkit]`
- User messages: mono paper card with an ember left rule and "→" marker
- Assistant messages: serif text with no bubble and a thin ember left rule
- Input and send button: square corners, ember focus and send chip
- No flash of unstyled content; no uncaught console errors
