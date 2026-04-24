# QA: Pre-Built Popup — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/prebuilt-popup` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the neutral `sample_agent` graph (registered to the `prebuilt-popup` agent name)
- Note: the demo source contains no `data-testid` attributes. Checks below rely on verbatim visible text, role-based selectors, and DOM structure. The underlying agent is the neutral "helpful, concise assistant" (no frontend tools, no agent tools).

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/prebuilt-popup`; verify the main content renders with heading (h1, text: "Popup demo — look for the floating launcher") and paragraph body mentioning `<CopilotPopup />`
- [ ] Verify a floating launcher button is visible in a corner of the viewport (typically bottom-right)
- [ ] Verify the `<CopilotPopup />` window is OPEN by default (`defaultOpen={true}` in source) — a chat overlay sits on top of the page content with an input at the bottom
- [ ] Verify the chat input placeholder is verbatim "Ask the popup anything..."

### 2. Feature-Specific Checks

#### Popup Open / Close

- [ ] With the popup open, click the popup's close control (X button in the popup header); verify the popup window collapses and only the floating launcher remains
- [ ] Click the floating launcher; verify the popup re-opens showing the prior transcript (if any)
- [ ] Verify opening/closing does not trigger a full page reload (URL remains `/demos/prebuilt-popup`, main content stays mounted)
- [ ] Verify the popup overlays the page content rather than pushing layout (unlike the docked sidebar form factor)

#### Suggestions (`useConfigureSuggestions`)

- [ ] With the popup open, verify a suggestion pill titled "Say hi" is rendered in the chat surface (configured with `available: "always"`)
- [ ] Click the "Say hi" pill; verify it sends the message "Say hi from the popup!" and an assistant text response appears within 10s

#### Chat Round-Trip

- [ ] Type "Hello" into the popup chat input ("Ask the popup anything..." placeholder) and submit; verify the user bubble appears, followed within 10s by an assistant text response
- [ ] Send a second message; verify a second valid response appears and the transcript auto-scrolls to the latest turn
- [ ] Close the popup and re-open it; verify the existing transcript persists within the open session

#### Agent Wiring

- [ ] Confirm (via DevTools → Network) that chat submissions POST to `/api/copilotkit` with agent name `prebuilt-popup` in the payload; response streams back as SSE with no 4xx/5xx status

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user bubble, no network request)
- [ ] Resize the viewport to ~375px wide (mobile); verify the popup adapts (full-width or close to it) without clipping the input, header, or close button
- [ ] Stop the backend, send a message; verify the UI surfaces a visible error path rather than hanging silently; DevTools → Console shows no uncaught errors during any flow above

## Expected Results

- Page + popup render within 3 seconds
- Assistant text response within 10 seconds
- Popup open/close animates smoothly with no layout jank
- Floating launcher remains accessible (not clipped) at all tested viewport sizes
- No UI layout breaks, no uncaught console errors
- The neutral agent (no tools) simply chats — no frontend tool registrations, no tool-call UI expected in this demo
