# The demo beats — what a skin has to prove

A skin is not a theme. It is a **live sales demo** that proves CopilotKit and
Intelligence top to bottom, in a domain a Fortune 500 buyer recognizes. The
banking skin ("Northwind Finance") is the reference: its ~10 steps are tuned and
they land with customers. **Copy its beats, not its steps.**

> "Your use case can be 1000% different. Totally cool. But you still want to hit
> those beats of: I can manipulate the app, I know what's on the page, I've got
> long-term memory, I've got a stored procedure, I can create a stored
> procedure." — the demo walkthrough that defines this file

Each beat below states **what the audience must conclude**, then what your skin
has to implement for that conclusion to land, then how banking does it. The
audience conclusion is the point; the mechanism is negotiable.

---

## The beat map (fill this in BEFORE writing code)

Author this table first, in your plan or as a comment at the top of
`src/skins/<id>/suggestions.ts`. One row per beat, no rows omitted — write
`SKIPPED — <reason>` in a cell rather than deleting the row, so a reader can
tell a deliberate choice from an oversight.

```markdown
| Beat              | This skin's step | Pill | Implemented by |
| ----------------- | ---------------- | ---- | -------------- |
| 1 face            |                  |      |                |
| 2 rich thread     |                  |      |                |
| 3a drive the app  |                  |      |                |
| 3b sees my screen |                  |      |                |
| 3c levers         |                  |      |                |
| 3d multimodal     |                  |      |                |
| 4 memory          |                  |      |                |
| 5 stored skill    |                  |      |                |
| 6 teach a skill   |                  |      |                |
```

**If the user named which beats to hit** — fewer, more, or different ones — theirs
win outright. Record what they asked for in the map (`"user: BI dashboards only,
no teach mode"`) and build that. Absent instructions, build all nine rows: that
is what makes a skin demo-complete, and three of the four shipped skins are
missing most of them (see "Which skin to copy" at the end).

---

## Beat 1 — Give the agent a face

**Audience concludes:** this agent has a face. Generative UI is the reason people
come to CopilotKit in the first place, so lead with it — never open with a wall
of text.

**Your skin needs:** a `useComponent` that renders a real visual (chart, tile
row, card) from live skin data, as the answer to the very first pill. Pair the
visual with one or two sentences of prose — a chart with no words reads as a
glitch, and prose with no chart wastes the beat.

**Banking:** pill `"Show the spending trend"` → `showSpendingTrend`
(`tools.tsx:797`) renders a hand-rolled SVG chart from the live ledger. Its
sibling charts (`showBudgetUsage`, `showSpendBreakdown`,
`showIncomeVsExpenses`) all carry a shared `CHART_ANSWER_RULE`
(`tools.tsx:694`) instructing the agent to render the chart **and** answer in a
sentence or two.

---

## Beat 2 — The thread is rich, not text

**Audience concludes:** these threads store AG-UI streams, not text. Click across
threads, hard-reload the browser, come back — the chart is still there. On any
other product on the planet that chart is gone and only text remains.

**Your skin needs:** durable visuals registered as `useComponent` (they replay
from thread history) rather than as a `useFrontendTool` render, **and tools
written to be replay-safe.** This is the part that silently breaks:

- **Key a render off the tool `result`, not off `status`.** On replay you get the
  recorded result, not a live status transition. A render keyed on `status`
  looks perfect during the live run and renders blank or wrong the moment the
  thread is reopened.
- **Re-derive display state from the replayed result.** Never depend on client
  state that only existed during the live call.
- **Keep secrets out of what you re-derive** (see beat 3a).

**Banking:** `setCardPin` re-derives its resolved card from the replayed tool
result plus a module-level map holding only `brand`/`last4` — never the PIN
(`tools.tsx:70-89`, `418-451`); `showCharges` explicitly keys off `result` and
not `status` (`tools.tsx:553-572`).

**⚠️ Runtime-conditional.** Durable cross-reload thread history exists only in
**Intelligence mode** — all three of `INTELLIGENCE_API_URL`,
`INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY` set. The default OSS path
uses `InMemoryAgentRunner` and is ephemeral. No skin code persists anything.
Demo this beat in Intelligence mode or not at all — and write your tools
replay-safe regardless, because the failure is invisible until you reload.

---

## Beat 3 — Manipulate the app (four sub-beats)

These four are one argument made four ways: **the agent drives your real
application.** Do not collapse them into one step; each closes a different
objection.

### 3a — Drive the app, and prove the secret never left the UI

**Audience concludes:** it really changed the app — and the sensitive value was
never sent to the assistant.

**Your skin needs:** a mutation the agent initiates whose sensitive payload it
never sees, because the user types it into a component in the chat. Two things to
get right: the agent must be told **never to ask for the secret and never to ask
which record first** (it should fire the tool immediately), and the gen-UI from
beat 1 must **stay** in the transcript — the conversation must not collapse into
"OK, PIN set."

**Banking:** pill `"Change my card PIN"` → `setCardPin` (`useHumanInTheLoop`,
`tools.tsx:399`) opens `PinChangeCard` in the chat; the user picks the card and
types the digits there. `changePin` goes straight to REST and the agent's
`respond()` gets only `"PIN updated on the {label}."` The prompt is explicit:
"NEVER ask for PIN digits, never repeat them, and never ask which card first"
(`agent.ts:144`).

### 3b — "What's on my screen?" — asked twice, on two different pages

**Audience concludes:** shared state is real. Not everyone understands it, so
show it: ask on one page, navigate, ask again. Different, correct answer both
times.

**Your skin needs — and this is the beat most often broken by omission:**

1. **A route readable.** `useAgentContext({ description: "The current page…",
value: <current segment> })` in your layout. Without it the agent has no idea
   which page is open.
2. **Per-page readables that describe what is visibly on screen** — active
   filters, the rows actually rendered, the figures shown. Register these in the
   _page components_, not only globally.
3. **A prompt clause** telling the agent that its context **is** its view of the
   screen: name the page, summarize the key elements, cite the actual figures,
   and **never** say it cannot see the screen.

Every shipped skin registers readables. Only banking registers a route readable
and per-page on-screen readables — which is why this beat is impossible in
airline, logistics and keel today: they answer identically no matter which page
is open.

**Banking:** route readable at `layout.tsx:141-143`; global page/operation
readables at `tools.tsx:162-170`; page-scoped on-screen readables in
`dashboard.tsx:148`, `cards.tsx:376`, `team.tsx:54`, and — the richest —
`charges.tsx:139`, which emits the page name, the active filters, the visible
row count and the first 25 visible rows. Prompt clause "SCREEN AWARENESS" at
`agent.ts:61-71`.

### 3c — Navigate with levers, and make it complicated

**Audience concludes:** it didn't follow a link — it performed a maneuver through
the app's real controls, and those controls are genuinely wired.

**Your skin needs:** one tool that (i) confirms first via HITL, naming the
filters it is about to apply, (ii) navigates, (iii) applies a sort **and** a
filter through the page's real query params, and (iv) leaves the applied levers
**visibly highlighted** so the audience can see the agent set them. A plain
`navigateTo` does not earn this beat.

**Banking:** pill `"Show me the 10 most expensive charges"` → `showCharges`
(`useHumanInTheLoop`, `tools.tsx:513`) renders `NavigateConfirmCard` listing the
sort + filters _before_ navigating, then pushes
`/banking/charges?sort=amount_desc&top=10`. The page reads those params
(`charges.tsx:42-53`) and sorts/slices. The highlight is an `activeSelect` tint
on the Sort and Top-N controls when set from the URL — `border-brand/50
bg-brand-soft font-semibold text-brand-indigo` (`charges.tsx:67-68`) — plus a
rank column when sorted by amount. Note it is the **controls** that light up, not
the rows.

### 3d — Multimodal in, durable artifact out

**Audience concludes:** it takes real documents, and what it produces belongs to
the _application_, not to the chat. Delete the whole thread — the artifact is
still there, because it is part of your product.

**Your skin needs:** an attachment path, plus a tool that writes its output to
your skin's **store**, plus a surface in the app that lists those artifacts.
Deleting the thread must not remove it. In-memory skins can fake half of this;
a server-backed store makes it true.

Two mechanics worth copying verbatim:

- **The framework's suggestion path drops attachments.** So a pill that must
  carry a file has to intercept via `onSuggestionSelect`, stage the file into the
  composer's hidden `input[type=file]`, then drive the real composer textarea and
  send button. Share the message string as a constant between the pill and the
  handler so the match cannot drift.
- **Give the presenter a paperclip too** via `chatHeaderActions`, so the file can
  be staged manually if the pill path misbehaves on stage.

**Banking:** pill `"Prep the Q2 spend report"` → `onSuggestionSelect`
(`skin.tsx:143-149`) matches the shared `Q2_REPORT_MESSAGE` constant and calls
`sendQ2WithInvoice()`, which stages the bundled PDF via `stageInvoiceAttachment`
(`attach-invoice.ts`) and drives the composer. The `createReport` frontend tool
(`components/wow/report-tool.tsx:20`) POSTs to `/api/banking/v1/reports`; the
filed report renders in the dashboard's **Reports tab** (`reports-view.tsx`),
keyed to the app and not the thread. The prompt's UPLOADED DOCUMENTS clause
(`agent.ts:319-328`) tells it to read the PDF and merge the invoice's line items
into the report via `createReport`'s `additions` array.

---

## Beat 4 — Long-term memory: it remembers how you like things

**Audience concludes:** it remembers me across sessions, and it will tell me what
it remembered.

**Your skin needs:**

1. **A seeded topical memory** describing a formatting or workflow preference —
   see "Seeding memories" below.
2. **A prompt clause** that forces `recall_memory` _before_ answering the class of
   question the preference applies to.
3. **A component with a slot for the "why."** The recalled preference must be
   surfaced, not just silently obeyed — otherwise the audience sees a normal
   answer and the beat is invisible.
4. **A remembering voice** in the prompt: "You like these by team, so…"

**Banking:** pill `"Summarize our spend"` → prompt clause at `agent.ts:166-174`
forces `recall_memory` first, then `showSpendSummary` (`tools.tsx:704`) receives
`overLimitFirst` / `rounded` from what was recalled, and its **`note` parameter
is where the agent names the preference it applied**. The seeded memory
(`intelligence/seed-memories.ts:33-52`) reads: spend summaries grouped by team,
anything over its policy limit called out first, figures rounded to whole
dollars.

**⚠️ Runtime-conditional.** `recall_memory` / `save_memory` are attached only in
Intelligence mode. Without those env vars this beat silently degrades to a
generic answer.

---

## Beat 5 — Stored procedure: "handle it"

**Audience concludes:** one vague sentence, and it already knows our procedure —
several steps, in order, no hand-holding.

**Your skin needs:**

1. **A seeded operational memory holding a literal, ordered procedure** — the
   numbered steps, plus "run all of them immediately, in order, without asking
   for confirmation."
2. **Three-ish `useFrontendTool` writes** that the procedure fires, registered
   globally (they must be callable from anywhere), each producing a **visible**
   change.
3. **Distractor tools** registered alongside them, so "it picked the right three"
   means something.
4. **Explicit prompt separation from beat 6's procedure.** These two are the
   easiest thing in the whole demo for the agent to confuse. Say plainly that
   this is a _different_ procedure and it must not offer to record anything.
5. **A prompt clause** that finding the record is not handling it.

**Banking:** pill `"I don't recognize the Delta charge"` → seeded operational
memory (`seed-memories.ts:61-76`) → `flagForReview` (`tools.tsx:323`) +
`sendSpendAlert` (`tools.tsx:296`) + `addNoteToTransaction` (`tools.tsx:347`).
The note tool **force-prepends a 🚨** when the text reads as an alert
(`tools.tsx:363-374`) so the change is un-skimmable on a projector. Prompt clause
"SUSPICIOUS / UNRECOGNIZED CHARGES FOLLOW A SAVED PROCEDURE" at
`agent.ts:176-190`, including "This is a DIFFERENT procedure from clearing an
over-limit charge — do not confuse the two, do not offer to record anything."

**⚠️ Runtime-conditional** (Intelligence, as beat 4).

---

## Beat 6 — Create a stored procedure: teach it

**Audience concludes:** when it _doesn't_ know, it learns by watching me once —
and then does it alone, on a different case.

**Your skin needs five parts.** Full spec for the banking implementation is in
`docs/teach-mode/README.md`; read it before building your own.

1. **A gate that fails with symptoms only.** An action that returns a refusal
   naming the problem and never the fix. Banking: `PUT
/api/banking/v1/transactions/[id]` → `422 OVER_POLICY_LIMIT`.
2. **An unlock path with decoys.** A multi-step way through — and near-miss
   options that look plausible and don't work, so the demonstration is a real
   demonstration. Banking: `data/policy-exception-codes.ts` (justifying codes,
   decoy codes, invalid codes rejected without enumeration) + the `exceptions`
   and `exceptions/[id]/finalize` routes.
3. **An agent framed to decline rather than bluff.** The prompt withholds the
   recipe and carries an ACTION DISCIPLINE clause so it says "I don't know this
   one — want me to record how you do it?" instead of improvising.
4. **A recording context with live, visible feedback.** Banking:
   `components/recording-context.tsx` (ref-counted `beginRecording`/
   `endRecording`, `logStep`, `getDemonstratedCode`), plus a step feed
   (`recording-feed.tsx`) and a violet canvas-edge glow (`recording-vignette.tsx`)
   so the audience can see recording is live.
5. **Save → recall → replay on a _different_ instance.** The case you taught it
   on is already resolved by the demonstration, so seed **at least two** gated
   records. The proof is it handling the second one unaided.

**Banking's HITL chain:** `offerWorkflowRecording` (`tools.tsx:1094`) →
`awaitDashboardDemonstration` (`1169`, live pulsing "Rec" badge + step feed) →
`saveLearnedWorkflow` (`1251`, then `save_memory` with scope `project`, kind
`operational`) → replay via `openPolicyException` (`903`) →
`finalizePolicyException` (`970`) → `approveTransaction` (`1029`).

**⚠️ Runtime-conditional.** Gate → unlock is provable over pure REST today
(`docs/teach-mode/verify-teachable-gate.sh`). Durable save → recall → _fresh
thread_ needs Intelligence. `pnpm test:self-learning` covers it deterministically
via aimock.

---

## Seeding memories (load-bearing for beats 4, 5 and 6)

Beats 4 and 5 are **seeded, not emergent** — "it already knows me" is a file. Add
`src/skins/<id>/intelligence/seed-memories.ts` alongside your `user-id.ts` and
mirror `src/skins/banking/intelligence/seed-memories.ts`. Three rules:

- **Seed the topical preference** (beat 4) and the **operational procedure**
  (beat 5).
- **Deliberately do NOT seed beat 6's procedure.** That is the one the agent must
  learn on stage. Banking's seed file omits it on purpose
  (`seed-memories.ts:53-60`) — if you seed it, beat 6 has nothing to teach.
- **Scope them** so beat 5's procedure and beat 6's learned procedure can never
  be mistaken for each other. Banking scopes the learned one `project` /
  `operational` and words both prompts to force the distinction.

Reset must re-seed. See the Reset requirement below.

---

## Presentation requirements (not beats, still mandatory)

**A pill for every beat, in demo order.** The presenter should never type — "make
sure that the bubbles are in there so I never have to type, I could just click."
This is also a correctness measure: free-typed phrasing routes wrong. Saying
"show me the spending **report**" instead of "trend" sends banking to the canvas
report tool rather than the in-chat chart. Pills remove that whole class of
stage accident. Banking ships 8 pills covering its full flow; airline, logistics
and keel ship 4–5 with partial coverage.

**Every mutation gets a visible affordance.** "Make sure that you use like a
light or a bell or whatever so people can see that it changed." If the audience
can't see the change, it didn't happen. Patterns already in the repo: the forced
🚨 note prefix, the brand-tinted `activeSelect` filter controls, airline's
`ring-2 ring-brand-indigo` seat highlight, keel's agent-navigated section
highlight, the pulsing Rec badge and recording vignette. (Note
`banking/components/wow/proactive-notice.tsx` is an `animate-ping` bell toast
that is defined and **mounted nowhere** — it is available, not in use.)

**The prose has to be pretty.** "Ask a text question and make sure the prose
comes through really pretty — use that markdown for the bold highlighting."
Put it in the prompt: bold the key figures, keep answers short, and never emit a
raw markdown table where a gen-UI component exists for that data. Banking's
prompt says "NEVER WRITE A MARKDOWN TABLE" and routes to `showTable`/`showCharges`
instead (`agent.ts:74-80`).

**A Reset control.** Presenter-gated, in the layout's meta-utility strip; see
SKILL.md § "The meta-utility strip". Reset must restore the data store, **wipe
learned memories**, and **re-seed** the "already knows" ones — while still
leaving beat 6 unlearned. Banking's `dev/reset` route does exactly that. Only
banking and logistics ship both the route and the button today.

**Open with the placement framing.** Say up front: this is your application, and
the assistant can be a docked panel, a bubble, a standalone app, or its own
window. The chat sitting on the _left_ reads as unusual to people who expect
in-app agents on the right, so say it rather than letting the audience wonder.
The shell backs this up — the selector card can swap the assistant's side or hide
it entirely, and the preference persists shell-global.

**Roughly banking's number of steps.** ~10 beats-worth. Not 4, not 25.

---

## Choosing a domain, and the quality bar

If nobody named a domain, pick one that a Fortune 500 buyer sees themselves in.
The ask is 8–12 skins spanning that space. Two are called out explicitly:

- **Business intelligence / executive analytics — the highest-stakes skin.**
  "Take my data and show it real pretty for me, and then manipulate and do stuff
  with it." This is the one that opens doors at CEO / CFO / COO / VP level, and
  it has to be **the prettiest thing we ship** — "ultra, ultra pretty, as pretty
  as we can possibly make it."
- **Real-time collaborative editing with AI.** Notoriously painful to build
  yourself, which is exactly why showing it working closes people.

Other domains that fit the same buyer: healthcare operations (shipped as `keel`),
supply chain / logistics (shipped), insurance claims, field service, HR and
recruiting, legal contract review, retail merchandising, energy and utilities
operations, customer-support command centers, manufacturing quality.

**The bar is "holy shit" pretty, not "renders correctly."** Arm sales with
something beautiful and they close monster deals; ship template output and the
beats land flat no matter how correct the wiring is. Budget real design effort,
and use the workspace's frontend-design skill rather than eyeballing it.

---

## Which skin to copy for what

| Need                                  | Copy from                                                |
| ------------------------------------- | -------------------------------------------------------- |
| Every beat, end to end                | `banking` — the only skin at 6/6                         |
| Route + on-screen readables (beat 3b) | `banking` — the only skin with them                      |
| Teach mode (beat 6)                   | `banking` + `docs/teach-mode/README.md`                  |
| Attachment staging (beat 3d)          | `banking` — `attach-invoice.ts`, `skin.tsx`              |
| Debugged layout + meta-utility strip  | `logistics`                                              |
| Server-emitted a2ui canvas            | `logistics` (`renderBrief`), `banking` (`render_report`) |
| Per-user identity plumbing            | `banking`, `logistics`, `keel`                           |
| Parameterized routes in `resolvePage` | `keel` (`knowledge/<docId>`, `runs/<runId>`)             |
| In-memory `useData` substrate         | `airline`, `keel`                                        |
| Minimal contract surface              | `airline`                                                |

**Do not use airline, logistics or keel as demo-completeness references.** They
predate this bar: each hits roughly one beat of nine. Logistics and keel are
especially misleading — both ship the full per-user identity plumbing
(`RuntimeProviders`, `useRuntimeProperties`, server `identifyUser`) and then no
memory prompts, no memory tools and no seed file, so they get zero demo value
from the hardest part. They are excellent _wiring_ references and incomplete
_demo_ references.
