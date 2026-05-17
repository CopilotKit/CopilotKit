# Proto-E2E test catalog

A map of behaviours `@copilotkitnext/slack` must get right. Organised
by **technical axis**, not by product feature.

## Coverage levels

- **unit** — `src/__tests__/*.test.ts` + `app/**/__tests__/*.test.ts`.
  Vitest. ~400ms. Locks in internal contracts (queue invariants,
  listener filters, mrkdwn translation, auto-close semantics, store
  fold logic, HITL registry, interrupt capture).
- **live E2E** — `e2e/run.ts` harness. Sends real messages via Slack
  Web API with the user OAuth token (`xoxp-`), polls
  `conversations.replies` during streams, runs per-case assertions.
- **manual** — verified by sending a message in Slack during
  development. No automated check yet.

**Status legend**

- ✅ unit-tested (vitest) or live-verified in Slack
- 🟡 implemented in code; no test pointed at it
- ❌ known gap / not implemented
- 📋 explicitly deferred (phase 2+)

---

## A. Trigger surface

| # | Case | Status |
|---|------|--------|
| A1 | Top-level mention in a public channel → new thread | ✅ live |
| A2 | Mention inside an existing thread → reply in that thread | ✅ unit |
| A3 | Mention inside a thread the bot owns → continue that thread | ✅ unit |
| A4 | Plain reply (no mention) in a thread the bot owns | ✅ live + unit |
| A5 | Plain reply in a thread the bot does NOT own → ignore | ✅ unit |
| A6 | DM to bot | ✅ live |
| A7 | DM continuation, Nth message | 🟡 |
| A10 | `/agent <text>` slash command | ✅ unit |
| A11 | `/agent` (empty text) → no-op | ✅ unit |
| A12 | Repeat `/agent` from same user → same conversation scope | ✅ unit |
| A13 | Bot @-mention with no text after | ✅ unit |
| A14 | Bot @-mention with only whitespace | ✅ unit |
| A15 | Multiple bot mentions in one message → one turn | ✅ unit |
| A16 | Mention in a channel bot isn't in → silent (Slack platform) | ✅ |
| A17 | Mention strips OTHER users' mentions from the forwarded text | ✅ unit |
| A18 | Bot reads `@here` / `@channel` as non-trigger | ✅ unit |
| A19 | Channel-join / channel-leave events ignored | ✅ unit |
| A20 | Edited message of a prior mention → NOT re-triggered | ✅ live + unit |
| A21 | Deleted user message → no-op | ✅ unit |

## B. Response length / shape

| # | Case | Status |
|---|------|--------|
| B1 | Empty response (START + END, no content) → no Slack post | ✅ unit |
| B2 | Single-token response | ✅ live + unit |
| B3 | Two-delta "E"+"CHO" regression | ✅ unit |
| B6 | Long multi-paragraph response | ✅ live |
| B7 | Long response within model bounds | ✅ live |
| B8 | Concatenated chunks equal full buffer (no loss) | ✅ unit |
| B9 | Frozen chunk boundaries don't shift on growth | ✅ unit |
| B10 | Prefer newline break, then space, for chunk boundaries | ✅ unit |
| B11 | Markdown bold/italic → mrkdwn | ✅ unit + live |
| B13 | Markdown bullet lists → mrkdwn `•` | ✅ unit + live |
| B14 | Markdown links → `<url\|text>` | ✅ unit |
| B16 | Fenced code blocks preserved | ✅ unit + live |
| B17 | Markdown tables → column-aligned monospace fallback | ✅ unit + live |
| B-chunk-spill | Long fenced block lands WHOLE in one Slack message (boundary moves before fence opener) | ✅ live + unit |

## C. Streaming dynamics

| # | Case | Status |
|---|------|--------|
| C1 | At most one `chat.update` in flight per message (queue invariant) | ✅ unit |
| C2 | Final flush wins over earlier in-flight update | ✅ unit |
| C3 | Throttle floor between flush completions | ✅ unit |
| C4 | Duplicate appends produce no extra `chat.update` | ✅ unit |
| C5 | `finish()` is idempotent | ✅ unit |
| C6 | `finish()` before any append → no Slack post | ✅ unit |
| C7 | A `chat.update` that throws is swallowed; next append retries | ✅ unit |
| C8 | Two AG-UI messages in one run → separate Slack messages | ✅ unit |
| C-stream-1 | Mid-stream bracket polish (open fence) — every sample balanced | ✅ live (flaky on freshly-opened fences; see #48) |
| Interrupt | Reply mid-stream cancels in-flight bot reply; `_(interrupted)_` suffix appended; new turn produces fresh reply | ✅ live + unit |

### Cs — Auto-close streaming polish

Without this layer an unclosed `` ``` `` or `**` mid-stream would
render the rest of the Slack message as broken code/literal text. The
auto-close transform appends the minimum closer needed; when the agent
emits the real close marker the buffer becomes balanced and we add
nothing.

| # | Case | Status |
|---|------|--------|
| Cs1 | Plain text passes through unchanged | ✅ unit |
| Cs3 | Unclosed `**bold` → `**bold**` | ✅ unit |
| Cs4 | `**` alone (no content) — do NOT close | ✅ unit |
| Cs6 | Unclosed `*italic` → `*italic*` | ✅ unit |
| Cs10 | Unclosed `` `code `` → `` `code` `` | ✅ unit |
| Cs13 | Unclosed fence → close on a new line | ✅ unit |
| Cs14 | Bare ``` ``` ``` — do NOT close | ✅ unit |
| Cs18 | Nested `**bold _italic` → `**bold _italic_**` (innermost first) | ✅ unit |
| Cs20 | Stream evolution: every delta produces sensible output | ✅ unit |
| Cs22 | Closer goes *before* trailing whitespace | ✅ unit |

## D. Conversation state & isolation

| # | Case | Status |
|---|------|--------|
| D1 | First turn rebuilds session from Slack (or starts fresh) | ✅ unit |
| D2 | Same thread → folded assistant turn from chunked bot replies | ✅ unit |
| D3 | Two threads in same channel → distinct sessions | ✅ live + unit |
| D5 | DM and channel for same user → distinct sessions | ✅ unit |
| D7 | New agent instance per distinct conversation key | ✅ unit |
| D-state-1 | Thread continuation without re-mention | ✅ live |
| D12 | Cross-conversation race: turn in A doesn't leak into turn in B | ✅ unit |

## E. Frontend tools, context, components, interactivity

| # | Case | Status |
|---|------|--------|
| E-tag-1 | Agent uses `lookup_slack_user` to render `<@USERID>` mention | ✅ live |
| E-context-1 | `defaultSlackContext` reaches the LLM (quotable from App Context) | ✅ live |
| E-component-1 | `defineSlackComponent` render fires; bridge posts Block Kit | ✅ live |
| E-hitl-1 | `defineHumanInTheLoop` posts an interactive picker | ✅ live |
| E-hitl-2 | Click resolves the wait with the value bound at `respond(value)` | ✅ unit |
| E-hitl-3 | Resolution render replaces the picker via `response_url` (`replace_original`) | ✅ unit + live |
| E-hitl-4 | `"delete"` return + no response_url → `chat.delete` fallback | ✅ unit |
| E-hitl-5 | Cancel-on-new-message: pending wait resolves `{kind:"cancelled"}` | ✅ unit |
| E-hitl-6 | Timeout: pending wait resolves `{kind:"timeout"}` after `timeoutMs` | ✅ unit |
| E-int-1 | `on_interrupt` custom event captured on the renderer | ✅ unit |
| E-int-2 | JSON-stringified interrupt value auto-parsed | ✅ unit + live |
| E-int-3 | Picker → click → resume the graph via `forwardedProps.command.resume` → agent's final reply | ✅ live |
| E-int-4 | Resolved-state render replaces the picker (response_url) | ✅ live |
| E-tool-status-default-off | No `:wrench:/:white_check_mark:` row by default | ✅ unit + live |
| E-tool-status-opt-in | `showToolStatus: true` posts status rows | ✅ unit |
| E-tool-status-dedup | Same `toolCallId` fires START twice → only one post (resume safety) | ✅ unit |
| E-restart-1 | Interrupt picker posted to Slack carries JSON-encoded resume values in `button.value` (round-trips Slack's storage) | ✅ live + unit |
| E-restart-2 | Bridge restart between picker-post and click: click still resumes the graph via decoded `value` (stale-click recovery) | ✅ live + unit + automated (pnpm e2e:restart) |
| E-restart-3 | `recoverInterruptFromStaleClick` posts `:warning:` when the resume `runAgent` throws | ✅ unit |
| E-restart-4 | Resolved-state render (replace picker with "✅ Booked X") fires on stale-click recovery — bridge re-reads `message.metadata` to recover handler name + agent payload | ✅ automated (pnpm e2e:restart) + unit |
| E-restart-5 | Picker carries `message.metadata.event_payload.{handler,payload}` so recovery can call `render({status:"resolved"})` | ✅ automated (pnpm e2e:restart) |
| E-restart-6 | Recovery skips resolved render gracefully when picker lacks metadata (older picker) | ✅ unit |
| E-restart-7 | Recovery skips resolved render gracefully when handler name isn't registered | ✅ unit |
| E-restart-8 | HITL restart recovery: stale click on a HITL picker → metadata-driven resolved-render replaces picker (no graph thaw needed — HITL run is already `RUN_FINISHED`) | ✅ automated (pnpm e2e:restart) |
| E-restart-9 | HITL picker carries `metadata.event_type: "copilotkit_slack_hitl"` with handler name + props | ✅ automated (pnpm e2e:restart) |

## F. Loop / echo / subtype filtering

| # | Case | Status |
|---|------|--------|
| F1 | Bot's own messages don't trigger the bot | ✅ unit |
| F2 | Other-app `bot_id` messages filtered | ✅ unit |
| F3 | `subtype=message_changed` (edit) ignored | ✅ unit |
| F4 | `subtype=message_deleted` ignored | ✅ unit |
| F5 | `subtype=channel_join` / `channel_leave` ignored | ✅ unit |
| F-edit | Editing a previously-sent message doesn't re-trigger | ✅ live + unit |
| F10 | `message.channels` echo of `app_mention` → skipped | ✅ unit |

## G. Error injection & resilience

| # | Case | Status |
|---|------|--------|
| G1 | Agent run throws → `:warning:` posted | ✅ unit |
| G2 | RUN_ERROR event → `:warning:` posted | ✅ unit |
| G2a | RUN_ERROR after intentional abort → suppressed (no warning) | ✅ unit |
| G4 | `chat.update` fails on one flush → swallowed | ✅ unit |
| G5 | Slack 429 rate limit | 🟡 (today: swallow; future: Retry-After) |
| G8 | Agent returns 5xx → caught → warning | ✅ unit |
| G15 | Agent emits END without START → renderer no-ops | ✅ unit |
| G-int-1 | Unknown `on_interrupt` event name → graph stays paused, warning logged | ✅ unit |
| G-int-2 | Payload fails Zod validation → graph stays paused, warning logged | ✅ unit |

## H. Lifecycle / concurrency

| # | Case | Status |
|---|------|--------|
| H1 | `start()` resolves `auth.test` before attaching listener | ✅ code |
| H6 | SIGINT triggers graceful shutdown | ✅ in `app/index.ts` |
| H7 | SIGTERM triggers graceful shutdown | ✅ in `app/index.ts` |
| H4 | Heavy concurrent load: many simultaneous mentions | 🟡 |
| H5 | Socket Mode WS drop → Bolt auto-reconnect | 🟡 (Bolt) |

## I. Slack feature surfaces (deferred)

| # | Case | Status |
|---|------|--------|
| I1 | Home tab | 📋 |
| I2 | AI Assistant pane (`assistant:write`) | 📋 |
| I7 | Modal submission | 📋 |
| I8 | File uploads in messages | 📋 |
| I9 | Ephemeral messages | 📋 |
| I10 | Canvas integration | 📋 |

## J. Multi-tenant / scale (deferred)

| # | Case | Status |
|---|------|--------|
| J1 | Multiple workspaces (org-deploy) | 📋 |
| J4 | Session TTL / eviction (Slack history fetch is the bound) | 📋 |
| J5 | Per-conversation rate limiting | 📋 |

---

## Open gaps worth naming

- **#48 — `isBalanced` predicate flake**: the auto-close transform
  intentionally skips just-opened fences (no body yet) to avoid
  emitting empty fenced blocks; the E2E harness's `isBalanced`
  predicate doesn't share that knowledge and occasionally flakes
  C-stream-1.
- **Slack rate-limit handling (G5/G6)**: today we swallow; should
  respect `Retry-After`.
- **Stream-error injection (G7/G9)**: kill the agent mid-stream and
  verify user-visible state — no test for it yet.

## Automated restart-recovery E2E (`pnpm e2e:restart`)

`e2e/restart-recovery.ts` exercises the full bridge-restart story
against real Slack. Flow:

1. Spawn bridge instance **#1** in-process. Start.
2. Post a user prompt → wait for picker.
3. Assert `message.metadata.event_payload.{handler,payload}` is set on
   the picker and every button's `value` is a parseable JSON object.
4. **Stop** instance #1 — in-memory registry is discarded.
5. Spawn bridge instance **#2** with a fresh registry. Start.
6. Pick a button and synthesise a Slack `block_actions` payload
   matching the shape Slack delivers; inject it into instance #2's
   Bolt app via `app.processEvent`.
7. Assert the picker has been **replaced in-place** by the
   resolved-state render (`✅ Booked …`) AND the agent's
   natural-language reply landed in the same thread.
8. Tear down instance #2.

The synthetic event skips Slack's WebSocket delivery for the click,
but the metadata + button.value round-trips are real (verified at
step 3 via live `conversations.replies(include_all_metadata=true)`),
so combined the test proves the whole chain.

## Live E2E run

`pnpm e2e` runs `e2e/run.ts` against `#ag-ui-bot-test` with the user
OAuth token. Each case sends a real prompt, polls
`conversations.replies` until the reply settles (or the case-specific
`maxWaitMs` elapses), runs the case's expectations, and writes a JSON
report under `e2e/results/`.
