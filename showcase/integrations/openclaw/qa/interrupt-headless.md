# QA: Headless Interrupt (OpenClaw)

Demo source: `src/app/demos/interrupt-headless/page.tsx`
Route: `/demos/interrupt-headless` · Agent: `interrupt-headless`
Run against the real backend at `http://localhost:3119/demos/interrupt-headless`.

Status: **not supported** on OpenClaw (intentional, fleet-normal). Listed under
`not_supported_features` in `manifest.yaml`; see `PARITY_NOTES.md`.

## Why it's not supported

The demo is built on LangGraph-native resumable `interrupt()` semantics: the
backend graph pauses mid-run, surfaces an `on_interrupt` custom event that the
page catches via `useAgent().subscribe`, renders a time-picker in the app
surface (left pane), and then **resumes the same paused run** by calling
`copilotkit.runAgent` with `forwardedProps.command.resume`.

OpenClaw is a stateless gateway, not a graph engine — there is no paused run to
resume. The `interrupt-headless` id is registered in the runtime only so
intra-app links and probe requests resolve cleanly; it maps to the same
pass-through gateway agent as every other demo, which never emits `on_interrupt`
and has no resumable checkpoint for a `command.resume` to attach to.

This demo is also quarantined in the LangGraph references themselves (a
`@copilotkit/react-core` resume-path issue), so it is not a gateway-specific gap.

## What to expect if you open it

1. Open the demo. The split layout renders: **Scheduling** app surface on the
   left showing the "Nothing scheduled yet" empty state
   (`data-testid="interrupt-headless-empty"`), chat on the right.
2. Click a suggestion (**Book a call with sales** or **Schedule a 1:1 with
   Alice**) or type a scheduling request.
3. The gateway agent replies conversationally, but **no time-picker popup
   appears** — the left pane stays on the empty state. The graph-side
   `interrupt()` / `on_interrupt` event that drives the popup never fires.

That is the expected (non-)behavior for this integration. There is no assertion
bar to pass here.

## Where HITL does work on OpenClaw

Human-in-the-loop is done **tool-based** rather than via graph interrupts. Use
these demos instead — both are supported and verified:

- `hitl-in-chat` (and `hitl-in-chat-booking`) — approval / choice UI in chat.
- `hitl-in-app` — a tool-driven picker rendered in the app surface, the
  supported analogue of what this demo attempts.

## Caveats

- Do not treat the registered `interrupt-headless` agent id as evidence of
  support — registration exists purely so links/probes don't 404 against the
  shared runtime.
- If a future OpenClaw build ever backs resumable runs, revisit this doc; today
  the resume path (`forwardedProps.command.resume`) is a no-op against the
  gateway.
