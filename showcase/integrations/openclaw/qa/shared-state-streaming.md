# QA: State Streaming (OpenClaw)

Demo source: `src/app/demos/shared-state-streaming/page.tsx`
Route: `/demos/shared-state-streaming` · Agent: `shared-state-streaming`
Run against the real backend at `http://localhost:3119/demos/shared-state-streaming`.

Status: **not supported** — listed in `manifest.yaml` `not_supported_features`
and in `PARITY_NOTES.md` under "Not supported (intentional, fleet-normal)".
This is fleet-normal: per-token predictive state is LangGraph-mostly (only
langgraph-python + google-adk ship it).

## Why it's not supported

The demo wants **per-token** streaming of a tool argument into shared state: as
the agent writes the `content` argument of a `write_document` tool, each token
should be mirrored into `state.document` immediately so the document panel fills
in character-by-character while the call is still in flight. In the LangGraph
reference this is one middleware entry (`StateStreamingMiddleware` mapping the
`write_document` tool's `content` arg → the `document` state key).

OpenClaw is a **single stateless gateway** with no per-demo backend and no
equivalent of that middleware. ag-ui does back bidirectional shared state
(via `forwardedProps.stateWriterTools` → a `STATE_SNAPSHOT` on tool completion —
that's what powers `shared-state-read` / `shared-state-read-write`), but a
`STATE_SNAPSHOT` is emitted **when the tool call resolves**, not per token. There
is no mechanism on the thin gateway to mirror an in-flight tool argument into
state token-by-token, so the demo's headline behaviour (a live, growing document
with a blinking cursor) has no backing.

## What actually happens if you run it

1. Open the demo. The document panel shows the empty-state hint ("Ask the agent
   to write something — its output will stream here token by token.").
2. Ask: **"Write a short poem about autumn leaves."**
3. Expect: the agent produces the text in chat, but the **document panel does
   not fill in per token**. `state.document` is not driven by a per-token
   argument delta, so the `data-testid="document-content"` panel stays empty (or
   updates only if/when a completed shared-state snapshot happens to carry a
   `document` key — it does not, here). The "LIVE" badge tracks `agent.isRunning`
   and the char counter reflects `state.document.length`, which stays `0`.

Do not treat a filled chat transcript as the demo passing — the assertion is the
**live document panel**, and that is what the gateway can't drive.

## Assertion bar

- N/A — feature not supported. There is nothing to assert as passing.
- If you're smoke-testing that the route loads: the page renders, the sidebar
  works, and chat responds (the shared gateway agent answers) — but the document
  panel will not stream.

## Caveats

- Frontend is the full claude-sdk-typescript demo (live `DocumentView`, "LIVE"
  badge, char counter); only the backing per-token stream is missing.
- If OpenClaw ever grows a per-token argument-delta → state hook (analogous to
  `StateStreamingMiddleware`), this demo would light up unchanged — the frontend
  already subscribes via `useAgent({ updates: [OnStateChanged,
OnRunStatusChanged] })`. Until then it stays honestly marked not-supported.
- For shared state that _does_ work on OpenClaw, see `qa/shared-state-read.md`
  and the read/write demo (snapshot-on-completion via `stateWriterTools`).
