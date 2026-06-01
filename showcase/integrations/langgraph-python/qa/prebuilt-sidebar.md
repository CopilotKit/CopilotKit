# QA: Pre-Built Sidebar — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/prebuilt-sidebar` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the neutral `sample_agent` graph (registered to the `prebuilt-sidebar` agent name)
- Note: the demo source contains no `data-testid` attributes. Checks below rely on verbatim visible text, role-based selectors, and DOM structure. The underlying agent is the neutral "helpful, concise assistant" (no frontend tools, no agent tools).

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/prebuilt-sidebar`; verify the main content renders with heading (h1, text: "Sidebar demo — click the launcher") and paragraph body mentioning `<CopilotSidebar />`
- [ ] Verify the `<CopilotSidebar />` is rendered docked to one edge of the viewport (typically the right edge) and is OPEN by default (`defaultOpen={true}` in source)
- [ ] Verify the sidebar contains a chat input and its own launcher/toggle button
- [ ] Verify the page body (main content) remains visible alongside the sidebar (sidebar does not fully overlay the page — docked form factor, not modal)

### 2. Feature-Specific Checks

#### Sidebar Toggle

- [ ] Click the sidebar launcher/close button; verify the sidebar collapses and the main content expands to fill the freed width
- [ ] Click the launcher again; verify the sidebar re-opens to its previous width
- [ ] Verify toggling does not trigger a full page reload (URL remains `/demos/prebuilt-sidebar`, no flash of unstyled content)

#### Suggestions (`useConfigureSuggestions`)

- [ ] With the sidebar open, verify a suggestion pill titled "Say hi" is rendered in the chat surface (configured via `useConfigureSuggestions` with `available: "always"`)
- [ ] Click the "Say hi" pill; verify it sends the message "Say hi!" and an assistant text response appears within 10s

#### Chat Round-Trip

- [ ] Type "Hello" into the sidebar chat input and submit; verify the user bubble appears, followed within 10s by an assistant text response
- [ ] Send a follow-up ("What can you help with?"); verify a coherent second response referencing prior turn is NOT required (agent has no persistent memory beyond the session thread) but a valid response appears
- [ ] Verify the transcript scrolls to the latest message automatically

#### Agent Wiring

- [ ] Confirm (via DevTools → Network) that chat submissions POST to `/api/copilotkit` with agent name `prebuilt-sidebar` in the payload; response streams back as SSE with no 4xx/5xx status

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user bubble, no network request, no assistant response)
- [ ] Resize the viewport to ~375px wide (mobile); verify the sidebar adapts (overlays content or stacks) without clipping the input or launcher
- [ ] Stop the backend, send a message; verify the UI surfaces a visible error path rather than hanging silently; DevTools → Console shows no uncaught errors during any flow above

## Expected Results

- Page + sidebar render within 3 seconds
- Assistant text response within 10 seconds
- Sidebar toggle is instant (<200ms) with no layout jank
- No UI layout breaks, no uncaught console errors
- The neutral agent (no tools) simply chats — no frontend tool registrations, no tool-call UI expected in this demo
