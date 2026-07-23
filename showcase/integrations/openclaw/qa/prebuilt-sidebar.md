# QA: Pre-Built Sidebar (OpenClaw)

Demo source: `src/app/demos/prebuilt-sidebar/page.tsx`
Route: `/demos/prebuilt-sidebar` · Agent: `prebuilt-sidebar`
Run against the real backend at `http://localhost:3119/demos/prebuilt-sidebar`.

Status: **supported** (chat / presentation, pass-through). Every demo agent
name maps to the one stateless OpenClaw gateway endpoint, so behaviour here is
plain chat plus the prebuilt `<CopilotSidebar />` layout — no per-demo backend.

## What it exercises

The prebuilt `<CopilotSidebar agentId="prebuilt-sidebar" defaultOpen={true} />`
docked to the edge of the viewport. It renders **open by default**, pushes the
page's `MainContent` instead of overlapping it, and is toggled with the
launcher. Three suggestion pills are wired via `useConfigureSuggestions`
(`available: "always"`): **Say hi**, **Fun fact**, and **Is 17 prime?**. There
are no frontend tools, shared state, or generative UI in this demo — it is the
sidebar chrome plus ordinary token-streamed chat over the gateway.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (per-demo agent names all map to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the sidebar renders **docked and open by default**,
   the main "Sidebar demo" heading and copy are visible to its side (content is
   pushed, not overlapped), and the launcher toggle is present.
2. Confirm the three suggestion pills render in the sidebar: **Say hi**,
   **Fun fact**, **Is 17 prime?**.
3. Click **Say hi** (or type "Say hi!"). Expect a streamed greeting from the
   agent within a few seconds.
4. Click **Is 17 prime?**. Expect a coherent streamed walkthrough concluding
   that 17 is prime.
5. Toggle the sidebar closed with the launcher, then re-open it. Confirm the
   page layout shifts on toggle and the prior chat transcript persists.

## Assertion bar

- Sidebar is docked and open on load; toggling it reflows the page (main
  content is pushed, not covered).
- All three suggestion pills render and each sends its configured message.
- Responses stream token-by-token and are coherent.
- Chat transcript survives a close/re-open of the sidebar.
- No console errors or broken layout during normal use.

## Caveats

- Pure chat + layout demo: no frontend tools, shared state, or generative UI to
  exercise here — the gateway is a plain pass-through for this route.
- Suggestions are static (`available: "always"`) and identical every load; they
  are not agent-generated.
- Response content is model-driven, so exact wording of greetings/fun facts
  varies run to run — assert on coherence and streaming, not exact text.
