# QA: Frontend Tools (In-App Actions) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/frontend-tools` on the dashboard host
- Agent backend is healthy (`/api/copilotkit` GET returns `langgraph_status: "reachable"`); `OPENAI_API_KEY` is set; `LANGGRAPH_DEPLOYMENT_URL` points at a deployment exposing the `frontend_tools` graph (registered under agent name `frontend_tools`)
- The backend `frontend_tools.py` registers NO server-side tools — the agent forwards the frontend tool schema at runtime; the browser owns the handler
- Frontend registers exactly ONE tool via `useFrontendTool`: **`change_background`** (parameter: `background: string` — a CSS background value, colors or gradients). Handler sets local React state and returns `{ status: "success", message: "Background changed to …" }`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/frontend-tools`; verify the page loads within 3s
- [ ] Verify the background container (`data-testid="background-container"`) is visible, full-screen, flex-centered
- [ ] Verify the initial background value is `var(--copilot-kit-background-color)` (the theme default) — inspect the container's inline `style.background`
- [ ] Verify the `CopilotChat` panel renders centered (max width 4xl, rounded-2xl corners) inside the background container
- [ ] Send "Hello"; verify the agent responds with plain text within 10s and does NOT call `change_background`

### 2. Feature-Specific Checks

#### Suggestion Pills

- [ ] Verify the "Change background" suggestion pill is visible above the input
- [ ] Verify the "Sunset theme" suggestion pill is visible
- [ ] Click the "Change background" pill; verify it sends the verbatim prompt "Change the background to a blue-to-purple gradient."

#### `change_background` — Successful Invocation

- [ ] After clicking the "Change background" pill (or typing "Change the background to a linear gradient from indigo to pink"), verify within 15s that the agent invokes the `change_background` tool
- [ ] Verify the `data-testid="background-container"` element's inline `style.background` mutates from `var(--copilot-kit-background-color)` to a CSS gradient string containing `linear-gradient` (or `radial-gradient`)
- [ ] Verify the change is visually reflected (color/gradient swap is instant, no flash)

#### Round-Trip — Agent References Tool Return Value

- [ ] Immediately after the background changes, verify the agent emits a follow-up assistant message that acknowledges the change
- [ ] Verify the follow-up message text references the new background value OR echoes the `"Background changed to <value>"` success message (confirming the agent consumed the handler's return payload, not just triggered the tool blindly)
- [ ] Ask "What color is the background right now?"; verify the agent replies with a description consistent with the last `change_background` call's argument (demonstrates the agent received the handler's return string into context)

#### Second Invocation — State Persistence

- [ ] Ask "Change it to a sunset gradient with orange and pink"; verify the background mutates again to a new gradient
- [ ] Verify the previous gradient is fully replaced (not layered)
- [ ] Ask "Now make it solid dark blue"; verify `style.background` becomes a solid color value (e.g. `#00008b`, `darkblue`, or `rgb(...)`) — no gradient keyword

### 3. Error Handling

- [ ] Send "Change the background to banana"; verify the agent either (a) calls `change_background` with a valid CSS fallback (e.g. `yellow`, `#FFE135`) and the container updates, or (b) declines politely without calling the tool — either is acceptable, but the UI must not crash
- [ ] Send an empty message; verify it is a no-op
- [ ] Send a ~500-character prompt unrelated to backgrounds; verify the agent responds normally without invoking `change_background`
- [ ] Open DevTools → Console; verify no uncaught errors, no Zod parse failures, no `useFrontendTool` warnings

## Expected Results

- Chat loads within 3 seconds; first `change_background` invocation completes within 15 seconds of prompt
- The `[data-testid="background-container"]` inline `style.background` updates in real time as the tool is invoked
- Agent's follow-up reply demonstrably uses the handler's returned `message` field (round-trip verified)
- Multiple sequential invocations replace the background cleanly with no visual artifacts
- No uncaught console errors; no broken layouts
