# QA: Pre-Built Sidebar — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/prebuilt-sidebar` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set on Railway (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests); the agent server (`src/agent_server.py`) mounts `prebuilt-sidebar` at `/prebuilt-sidebar`, bound in `src/agents/registry.py` to the shared `neutral_agent()` from `src/agents/chat.py`
- Note: the demo source contains no `data-testid` attributes of its own. Checks below rely on verbatim visible text, role-based selectors, and CopilotKit's built-in testids. The underlying agent is the neutral "helpful, concise assistant" (no frontend tools, no agent tools).

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/prebuilt-sidebar`; verify the main content renders with heading (h1, text: "Sidebar demo") and a paragraph mentioning `<CopilotSidebar />` that says it docks to the edge of the viewport and pushes the page content instead of overlapping it
- [ ] Verify the `<CopilotSidebar />` is docked to one edge of the viewport (typically the right edge) and is OPEN by default (`defaultOpen={true}` in source)
- [ ] Verify the sidebar contains a chat input and its own launcher/toggle button
- [ ] Verify the main content stays visible alongside the sidebar (docked form factor, not a modal overlay)

### 2. Feature-Specific Checks

#### Sidebar Toggle

- [ ] Click the sidebar launcher/close button; verify the sidebar collapses and the main content expands to fill the freed width
- [ ] Click the launcher again; verify the sidebar re-opens and the main content shifts back
- [ ] Verify toggling does not trigger a full page reload (URL remains `/demos/prebuilt-sidebar`)

#### Suggestions (`useConfigureSuggestions`)

- [ ] With the sidebar open, verify three suggestion pills render (configured with `available: "always"`) with verbatim titles:
  - "Say hi"
  - "Fun fact"
  - "Is 17 prime?"
- [ ] Click "Say hi"; verify it sends "Say hi!" and an assistant text response appears within 10s
- [ ] Click "Is 17 prime?"; verify it sends "Walk me through whether 17 is prime." and the reply concludes that 17 is prime

#### Chat Round-Trip

- [ ] Type "Hello" into the sidebar chat input and submit; verify the user bubble appears, followed within 10s by an assistant text response
- [ ] Send a follow-up ("What can you help with?"); verify a second valid response appears
- [ ] Verify the transcript scrolls to the latest message automatically

#### Agent Wiring

- [ ] Confirm (via DevTools → Network) that chat submissions POST to `/api/copilotkit` with agent name `prebuilt-sidebar` in the payload; the response streams back as SSE with no 4xx/5xx status

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
