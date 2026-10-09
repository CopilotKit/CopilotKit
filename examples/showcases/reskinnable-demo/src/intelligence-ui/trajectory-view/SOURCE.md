# Trajectory view: source

`index.html` is Atai's trajectory view prototype, copied from
**CopilotKitCommonAgentWorkspace `origin/main` @ 9c9dc16b**
(`2026-09-30-trajectories-view-prototype/deliverable01-trajectory-view/index.html`,
which includes PR #300: generative UI marked as placeholders, details in a popover).
`atai-9c9dc16b.original.html` is that file byte for byte, so `diff` shows every change.

It is served by `src/app/intelligence/trajectory-view/[id]/route.ts`. The trajectory route
(`/intelligence/trajectories/[id]`) shows it inside the same Intelligence shell as every other
`/intelligence` page, in an iframe so its stylesheet stays separate. In that embed (`?embed=1`)
only the page's own sidebar, breadcrumb bar (with the prototype badge) and background are hidden;
the content (title, Export / Add to Learning spaces, Show panel, timeline, details, key moments,
Learning spaces) is unchanged. Links open in the shell window, and the page reports its height
so the shell does the scrolling.
The only changes are the data layer and the labels that came from its sample trip:

- The hardcoded `EVENTS` sample is removed; `adapter.js` builds `EVENTS` from
  `/api/learning/v1/trajectories/:id` (sample-data fallback when the API is unreachable)
  and the page script runs through `window.__whenTrajectory(DATA)` instead of an IIFE.
- Header, details and key moments are filled from the data. Key moments tell our story:
  the agent's failed attempts, what the agent was missing, and the person's reference path.
- People and agent names in chat come from the data (they were "Sam Rivera" / "Travel assistant").
- Screen context renders the recorded fields (the flight thumbnail stays for its own data shape);
  the field that carries the missing rule is shown in red.
- Every agent-trace step and product event has a "Raw AG-UI event" disclosure with its event JSON
  (from `/api/learning/v1/trajectories/:id/agui`), and Export downloads that AG-UI payload.
- An agent trace group is titled with its surface (in-app agent, or ChatGPT via MCP).
- A failed tool call shows its error code with the page's existing `status bad` pill.
- Generative UI without a hand-made stand-in gets a generic one from the recorded props; the
  placeholder bar and popover are unchanged.
- Sidebar, breadcrumb and Learning-space labels point at Ledgerline and the /intelligence routes;
  Export downloads the trajectory from the export endpoint.
- Ledgerline's generative UI is drawn faithfully from the recorded props, in Ledgerline's look,
  with a "Generative UI · <Component> · drawn by <tool>" caption: the close status card
  (`showCloseStatus`) and the review card (`reviewMatches`, in the app and as ChatGPT's MCP app
  widget). These renderers live in `adapter.js` (`genericGen` dispatches to them); `index.html`
  only gains the icons they use in its Material Symbols `icon_names` list, and the placeholder
  popover's "See recorded props" reads the props of components without a hand-made stand-in.
- A component attaches to the agent's next message unless another component comes first or no
  message follows (ChatGPT); then it gets its own agent row right after the tool call that drew
  it, and the rest of that trace becomes its own group.
- Agent-trace steps that follow each other form one collapsed group row, even when they come
  from two threads (the in-app agent and ChatGPT running side by side), and a lone tool call is
  a group of one, so no tool call sits in the timeline as its own card. The group summary counts
  calls, sums their durations, shows one chip per tool with a count, and a red error count.
