# QA: Headless Chat — Simple (OpenClaw)

Demo source: `src/app/demos/headless-simple/page.tsx` (+ `chat.tsx`)
Route: `/demos/headless-simple` · Agent: `headless-simple`
Local: http://localhost:3119/demos/headless-simple

## What it exercises

The smallest possible bring-your-own-UI chat: two hooks (`useAgent` +
`useCopilotKit`) turn a plain shadcn/ui shell into a working chat, with no
`CopilotChat` component. `useAgent({ agentId: "headless-simple" })` exposes the
message log + run state; `copilotkit.runAgent({ agent })` runs it. Against
OpenClaw the run reaches the gateway through the ag-ui AG-UI channel (the
Next.js route proxies to the single stateless operator endpoint), and streamed
tokens come back over AG-UI. No demo tools, shared state, or reasoning are wired
here — the UI deliberately renders only plain user/assistant text.

## Manual steps

1. Open the demo. Confirm the "Headless Chat" card renders with its empty state
   (no `CopilotChat` UI — this is a hand-built shell) and a composer at the
   bottom.
2. Send: **"say hi"**.
3. Expect: a user bubble (right-aligned) appears immediately, a typing indicator
   shows while the agent runs, then an assistant bubble (left-aligned) streams
   in the reply.
4. Send a follow-up: **"what did I just say?"** Confirm the reply references the
   prior turn — message history is preserved across runs on the same agent.

## Assertion bar

- The reply streams token-by-token into the assistant bubble (not one atomic
  drop).
- The composer + send are disabled while `agent.isRunning`, then re-enable.
- No console errors during normal usage. (`runAgent` failures are logged to the
  console by design — the console should stay clean on a healthy backend.)

## Caveats

- Plain text only: this UI intentionally skips tool / system / non-string
  messages, so demo tools, shared state, and reasoning are not shown here — see
  the frontend-tools, shared-state, and reasoning demos for those.

## Protocol-level check (no browser)

Inside the running container, POST a minimal `RunAgentInput` (one user message,
no tools) to `http://127.0.0.1:8000/v1/ag-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) and confirm the SSE contains `TEXT_MESSAGE_START`
→ streamed `TEXT_MESSAGE_CONTENT` chunks → `TEXT_MESSAGE_END`, then
`RUN_FINISHED`.
