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
no teach mode"`) and build that — `bookstore` is the worked example of a
deliberately partial map, marking `3d multimodal` and `6 teach a skill` `SKIPPED`
with a reason on each rather than deleting the rows. Absent instructions, build all
nine rows: that is what makes a skin demo-complete, and every registered skin but
bookstore hits all nine, so a partial map has to be a stated decision rather than a
precedent to hide behind (see "Which skin to copy" at the end).

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
  thread is reopened. Lint-enforced per skin by `statusKeyedTerminalRender` in
  `eslint.config.mjs` — add your skin to its `files` glob (SKILL.md § "Registering
  tools" spells out the restate-every-selector rule that glob edit carries).
  `status === ToolCallStatus.Executing` on an interactive HITL branch is fine and
  is not matched.
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

**The card's own guidance must be a figure the card ACCEPTS.** Any ceiling, floor
or format the component PRINTS has to come out of the same expression its submit
predicate compares against. Print `up to ${formatMoney(itemValue)}` — rounded to
whole dollars — beside a button comparing the typed amount EXACTLY against
`itemValue`, and a $152.50 return invites "up to $153" and then sits disabled with
nothing on screen saying why. That is worse than a wrong number: the presenter
follows the app's own instruction on stage and the app refuses. Have one helper
return the guidance AND the predicate (`refundGuidance` in
`skins/commerce/data/derive.ts`), and print each figure from one place.

**And that helper must REFUSE a figure it cannot read, never rewrite it.** Parsing
the typed string with `Number(typed.replace(/[^0-9.]/g, ""))` deletes whatever it
does not recognise: `-50` becomes a real $50 refund and `1e5` becomes $15 —
finite, positive, under the ceiling, so nothing downstream can catch
either. On a beat-3a control the typed value IS the write, so validate
the whole string against one shape (tolerate a leading `$`, spaces, a thousands
comma; refuse a sign, an exponent, a second dot) and hand the caller a refusal it
can SAY out loud, plus a separate "nothing typed yet" flag so an untouched field
is not scolded.

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
   _page components_, not only globally. Each list in the readable must be the
   SAME expression the panel renders (one `useMemo`, mapped twice), never a second
   slice of the same source: a readable slicing 5 notifications against a panel
   showing 6 makes the agent describe the screen wrongly by one row — silently,
   which is the only failure mode this beat cannot survive.
3. **A prompt clause** telling the agent that its context **is** its view of the
   screen: name the page, summarize the key elements, cite the actual figures,
   and **never** say it cannot see the screen.

**Every shipped skin registers both**, so every one is a fair reference — and that
is worth deriving rather than believing:
`grep -rln useAgentContext src/skins/*/layout.tsx` is the route readable,
`grep -rln useAgentContext src/skins/*/pages/` the page ones. Both return every
registered skin, so a MISSING entry is the signal. The failure this beat dies of
is a route readable that was never written: the agent then answers identically no
matter which page is open, fluently, and only a presenter who asks twice notices.

**Banking:** route readable at `layout.tsx:141-143`; global page/operation
readables at `tools.tsx:162-170`; page-scoped on-screen readables in
`dashboard.tsx:148`, `cards.tsx:376`, `team.tsx:54`, and — the richest —
`charges.tsx:139`, which emits the page name, the active filters, the visible
row count and the first 25 visible rows. Prompt clause "SCREEN AWARENESS" at
`agent.ts:61-71`.

**Logistics** is the minimal worked example, and shows what "the same expression"
means when a panel has no filters at all: each page hands ONE collection straight
to its panel, so the readable maps that same variable and never re-fetches or
re-derives it. Its KPI half is the instructive part — the strip rounds
`onTimeRate` to "67%" for display, so the readable reads the exported
`deriveKpiTiles` the strip itself renders rather than the raw ratio, which an
agent quotes back as "66.7%". A one-decimal drift is small, but it is the same
KIND of error as the 5-rows-against-6 above, so both sides read one function.

**Guard it with TWO tests, because the two failures are different.** A source
grep (`src/skins/logistics/readables.test.tsx`) catches OMISSION — a readable
nobody wrote, which no render test can notice because the page renders fine and
the agent answers fluently, just identically everywhere. A render test
(`src/skins/logistics/pages/on-screen-readables.test.tsx`, and commerce's
`pages/orders.test.tsx`) catches DRIFT — it stubs `useAgentContext`, renders the
page, and asserts the readable's rows against the rows the DOM actually painted,
element for element and IN ORDER. Only the second one can see the commerce bug.
Two rules for the source grep: anchor every assertion INSIDE the construct it is
about (`toContain("Control Tower")` is satisfied by the page's own `<h1>`, and
`toContain("useSkinSegments")` by the nav's active-state call, so both stay green
with the readable deleted), and feed the render test a fixture LARGER than the
seed, or any cap you are guarding against sits unexercised.

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

**Logistics:** pill `"Costliest breaches"` → `showExceptionQueue`
(`useHumanInTheLoop`, `skins/logistics/tools.tsx`) names the levers as chips, then
pushes `?status=delayed&sort=value_desc&top=10`; the Control Tower reads all four
(`pages/control-tower.tsx`), tints each control that came from the URL, and adds a
rank column under a sort. Its lever vocabulary, chips, URL and tool enums all come
out of one module (`skins/logistics/data/exception-levers.ts`).

**Three ways the confirm card lies:**

- **A lever value the view will not honour.** Every value your schema advertises
  must have a control on the page, must filter, and must leave a view the agent
  can still DESCRIBE — check your global readable too, not just the page one.
  Advertise `status: "cancelled"` while the ledger readable filters cancelled
  orders out, and the one status only the agent can reach is the one it cannot
  talk about. Derive the schema's enums FROM the page's control
  vocabularies (`ORDER_STATUS_FILTERS`, `EXCEPTION_FILTERS`, `ORDER_SORTS` in
  `skins/commerce/data/derive.ts`) instead of hand-copying them, and the mismatch
  stops being possible. Same rule for a numeric lever: run it through the page's
  own parser (`parseTopLever`), because a limit the page ignores must not be drawn
  as a limit.
- **A chip for a lever nobody set.** Arguments STREAM, so the card renders while
  `args` is still half-empty. A `?? "all"` or a ternary ending in a bare default
  therefore asserts a choice the agent never made — and it can then flip. Draw
  the chips and build the URL from ONE normalized record
  (`skins/commerce/order-queue-levers.ts`), and give an unset lever no chip at
  all.
- **A lever the model set only because the schema let it.** DO NOT make your
  lever parameters `.optional()`. A model facing an optional enum fills it
  anyway, because omission is not a choice it can state. Told in as many words
  "take me to the Control Tower, do not filter anything, just limit it to the top
  3 rows", it still returns `exception=PORT_CONGESTION` **and** `status=on_track`
  — a pair no shipment satisfies — so the maneuver lands on an EMPTY board with
  four confidently tinted controls, and no prompt sentence closes it.
  Make each lever REQUIRED and put
  an explicit "not pulled" value INSIDE the enum (`"all"`, and `0` for a numeric
  limit) so the model can say it: `skins/logistics/data/exception-levers.ts`'s
  `ANY_LEVER`, and commerce's `"all"` in `ORDER_STATUS_FILTERS`. The sentinel is
  not in the page's control vocabulary, so the same `normalize…` call that drops
  junk drops it — no chip, no query param, no extra branch anywhere downstream.

**And one way the PAGE lies: a count that ignores the levers it sits under.** If
your view prints a "Top 10 of 22"-style caption, the denominator must be the
FILTERED, pre-truncation count — derived from the same pipeline the rows are, not
from `data.<collection>.length`. Take the unfiltered version and a lever set that
matches 13 rows reads "Top 10 of 22": the single number the room is asked to read
as proof of the maneuver instead says the filters did nothing. Publish two lengths
from ONE `useMemo` — `matching` (levers applied)
and `visible` (`matching` truncated) — and let the caption, the rows and the
readable all read those (`skins/commerce/pages/orders.tsx`). Any book-wide KPI you
show on the same page then needs to SAY it is book-wide, on screen and in the
readable (commerce captions its KPI row "The whole order book" and nests those
figures under a `book` key), because a page-level total beside filtered rows is
the same misread one step removed.

### 3d — Multimodal in, durable artifact out

**Audience concludes:** it takes real documents, and what it produces belongs to
the _application_, not to the chat. Delete the whole thread — the artifact is
still there, because it is part of your product.

**Your skin needs:** an attachment path, plus a tool that writes its output to
your skin's **store**, plus a surface in the app that lists those artifacts.
Deleting the thread must not remove it. A client-state store can only fake half of
this — the artifact dies with the tab, and the beat's claim is precisely that it
does not — which is one of the reasons no skin holds its data in client state.
Write the artifact through a REST route into a server store.

Three mechanics worth copying verbatim:

- **The framework's suggestion path drops attachments.** So a pill that must
  carry a file has to intercept via `onSuggestionSelect`, stage the file into the
  composer's hidden `input[type=file]`, then drive the real composer textarea and
  send button. Share the message string as a constant between the pill and the
  handler so the match cannot drift.
- **Give the presenter a paperclip too** via `chatHeaderActions`, so the file can
  be staged manually if the pill path misbehaves on stage.
- **DO NOT WRITE THE STAGING CHAIN. It is shell-owned:
  `src/shell/attach/stage-attachment.ts`, exported from `@/shell/attach`.** Your
  skin supplies three values — a document `url`, a `filename`, and the message
  the pill sends — and calls two functions:

  ```ts
  // Two lines, not one with an inline `type` — the commit hook's
  // `oxlint --fix` (consistent-type-imports) rewrites the inline form, so write
  // it this way and the hook leaves your file alone.
  import { attachByHand, sendMessageWithAttachment } from "@/shell/attach";
  import type { AttachmentDocument } from "@/shell/attach";

  const DOC: AttachmentDocument = { url: "…", filename: "…" };

  /** chatHeaderActions paperclip — stage only, no send. */
  export const attach<Id>ByHand = (): Promise<boolean> => attachByHand(DOC);
  /** onSuggestionSelect pill — stage, then drive the composer. */
  export const send<Id>WithAttachment = (): Promise<boolean> =>
    sendMessageWithAttachment(DOC, <ID>_ATTACHMENT_MESSAGE);
  ```

  That is the whole file. Every shipped wrapper that runs this beat
  (`banking/attach-invoice.ts`, `people/attach-offer-letter.ts`,
  `commerce/attach-price-sheet.ts`, `logistics/attach-rate-sheet.ts`) is about 45
  lines, most of it comment.

  **The attachment chain must fail LOUD, and must never send without the file.**
  This is not defensive polish; it is what makes the beat honest. If any failure
  still lets the prompt go out, the model INVENTS the document's contents, your
  tool files the artifact anyway, and it reads plausibly — so the beat proves the
  opposite of its claim and the room cannot tell.

  **You do not implement any of the below — the shell module already does.** It is
  written out because a skin author who does not know WHY the chain is shaped like
  this will eventually "simplify" it, reintroduce a fixed sleep, or bypass it with
  a hand-rolled sender. A sender whose staging result gates a 500 ms sleep and
  NOTHING ELSE still sends the prompt on a failed stage, and the demo still looks
  perfect.

  **Reporting a failure is the easy half. DETECTING it is the half that gets
  skipped.** Every step of this chain is a REQUEST made of framework code you do
  not own, so an unobserved step is an assumption. Nine ways it breaks, and what
  each one needs:

  | Failure                                                        | Detected by                                                                                                                                                                                  |
  | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The document route answers non-2xx                             | `!res.ok`                                                                                                                                                                                    |
  | The fetch throws                                               | its OWN `try`, not one wrapping the whole chain                                                                                                                                              |
  | A 2xx body that is empty, or an HTML error page served as 200  | check the BYTES (`%PDF` header), not the URL                                                                                                                                                 |
  | The composer's hidden `input[type=file]` is gone (an upgrade)  | `querySelector` returns null                                                                                                                                                                 |
  | Writing the file onto the input throws (`File`/`DataTransfer`) | a `try` around the DOM write, so it is not blamed on the fetch                                                                                                                               |
  | **The composer silently REJECTS the file**                     | `processFiles` drops anything failing `accept`/`maxSize` and calls an `onUploadFailed` nobody wires — so wait for an attachment CHIP to appear in `[data-testid="copilot-attachment-queue"]` |
  | **The file is still base64-ENCODING when you click send**      | `consumeAttachments` hands over only `ready` files and `onSubmitInput` refuses to send while anything is `uploading` — wait for the chip to print the filename                               |
  | **The send button is currently a STOP button**                 | one button plays both roles; mid-run a click CANCELS the run. Require the enabled + send-mark state                                                                                          |
  | The textarea's React value setter is gone, or the write missed | check `el.value` after writing — do NOT `setter?.call()` the only failure away                                                                                                               |

  The rules the shell module follows, so you can recognize a change that breaks
  one: locate the composer before staging; carry a machine-readable CAUSE, not a
  bare boolean, and give each cause its own sentence (a presenter needs to know
  whether to retry, press send by hand, or restart the dev server); abort the send
  on any failure; **wait on a CONDITION with a bounded budget, never on a fixed
  `setTimeout`** — a sleep that races an async encode is the defect, and an expired
  budget is a failure, not a green light; confirm the CLICK too (the attachment
  leaving the queue is the only proof `consumeAttachments` ran); report every
  failure with `console.error` AND `window.alert` (a log nobody opens mid-demo is
  not a report).

  Four more facts about the module you are calling:
  - **`AttachmentFailureCause` has fifteen members, not nine** — the table above is
    the taxonomy by mechanism; the union splits the send-side rows further (a
    disabled button, a STOP button and an unidentifiable button are three separate
    instructions to the presenter). Every one of the fifteen is emitted by the
    implementation AND driven by a test in
    `src/shell/attach/stage-attachment.test.ts`, and the exhaustiveness gate there
    is **type-only** on one half — Vitest transpiles without type-checking, so run
    `pnpm exec tsc --noEmit` if you touch the union. (Not `pnpm build`: `next build`
    type-checks only what the app's module graph reaches, so it never opens the
    test file that gate lives in. See SKILL.md § Verification step 1.)
  - **The `[attach:<cause>]` prefix on the `console.error` line is load-bearing,
    not decoration.** `attachByHand` and `sendMessageWithAttachment` return bare
    booleans, so the tagged log line is the ONLY place a send-path cause is
    observable; the test helper parses it with
    `/^\[attach:([a-z-]+)]\s+([\s\S]*)$/`, and seventeen cases across ten blocks
    depend on it. Tidying the tag out of the message silently blinds all of them.
  - **Both entry points take an optional `Beat3dTimings`** (`acceptMs`, `readyMs`,
    `sendableMs`, `consumedMs`, `pollMs`), so a test can force a budget to expire
    deterministically instead of sleeping a production budget. Your skin's own
    wrapper should NOT re-expose it — a skin has no reason to retune the
    framework's encode, and no skin-level test needs to (the expiry branches are
    covered once, in the shell).
  - **`NOTHING_SENT_LEDE` is overridden in exactly two places**, both deliberate:
    the paperclip path (nothing was going to be sent, so saying "nothing was sent"
    reads as a second phantom failure) and the unconfirmed-send path (a message
    may be in flight, and telling a presenter otherwise invites a DOUBLE SEND).
    Do not collapse those back to one lede.

  Neither `void`ing the promise nor wrapping it in a catching launcher is needed:
  both entry points are wholly inside their own `try` and report cause
  `"unexpected"` before resolving `false`, so neither can reject. A per-skin catch
  is just a third copy of a rule the shell owns — do not add one.

**Banking:** pill `"Prep the Q2 spend report"` → `onSuggestionSelect` matches the
shared `Q2_REPORT_MESSAGE` constant and calls `sendQ2WithInvoice()`
(`attach-invoice.ts`), a one-line wrapper over `sendMessageWithAttachment` that
stages the bundled PDF and drives the composer. The `createReport` frontend tool
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

**⚠️ This beat is the RECALL, never a per-person contrast.** Do not build it as
"same pill, two people on the switcher, two answers": the client's `properties`
frequently do not reach `identifyUser` on a run, so the on-screen people collapse
into one default memory bucket and switching re-scopes NOTHING. Every skin that
tried the contrast framing had to retract it. The authorities are the `CAVEAT`
block in `.env.example` and the flagged comments in
`src/shell/agent-registry.ts`; the seeding consequence is the fourth rule below.

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
6. **An explicit empty-recall branch.** The list above only covers the recall
   landing something — say what the agent must do when it doesn't. If the
   recall comes back empty, the prompt must have the agent say plainly that no
   saved procedure was found and stop there: not run the procedure's tools on
   a guess, not reconstruct the missing values from the catalog, the cart, or
   anything else on screen (an invented answer that looks right is worse than
   an honest "not found," because on stage the two are indistinguishable), and
   — this is the one that actually gets missed — not offer to learn, record,
   or be told the procedure. That offer belongs to beat 6; an empty recall
   here is a failure to report, not a cue to teach, and the two beats blurring
   together is exactly the confusion item 4 above already warns about.
   `src/skins/bookstore/agent.ts`'s clause-7 empty-recall branch is the worked
   example, added only after a live run improvised the forbidden teach-offer
   the moment recall came back empty.

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

   ⚠️ **The vocabulary leaks through FIVE GENERIC channels and closing four is
   closing none:** a `useAgentContext` readable, a `z.enum(YOUR_CODES)` on the filing
   tool's schema, the tool's own `description`, the prompt, and the refusal body.
   Parts 1 and 2 can be perfectly built and the answer still handed over through
   the first four of those. **Then enumerate YOUR skin's own channels, because
   the list of five is not exhaustive** — if any code-shaped value is stored on a
   record your ledger publishes, the ledger readable is a sixth: airline's
   `Booking.waiverGround` maps 1:1 onto a justifying category, so `store.snapshot()`
   strips it and `data/store.test.ts` pins the strip. Ask "what does my `/ledger`
   answer with", not just "what did I write into a prompt". Take a free `z.string()` on the code parameter
   and state the withholding in its `.describe()`. This INVERTS the enumerate-every-
   closed-set rule you follow everywhere else — for a gate, reaching the model is
   the defect. The guard is `withheldGateVocabulary` in `eslint.config.mjs`, and its
   `files` glob lists only the skins already fixed, so **append your skin's
   `tools.tsx` AND `agent.ts` when your gate lands or nothing checks it** — and
   restate the LOCK_SKIN selectors in that block, because flat-config `rules` are
   replaced rather than merged. It catches only the two channels that appear as
   identifiers; the three prose ones are a grep-and-read. Full account, plus the
   REST proof scripts: failure-modes.md § 10.

4. **A recording context with live, visible feedback.** **Do NOT write your own
   — import the shell's:** `RecordingProvider`, `RecordingFeed`,
   `RecordingVignette` and `useRecording` all come from `@/shell/teach`
   (ref-counted `beginRecording`/`endRecording`, `logStep(label, code?)`,
   `getDemonstratedCode()`), plus a step feed and a violet canvas-edge glow so the
   audience can see recording is live. Mount the provider and the vignette in your
   skin's `Providers` (banking's `providers.tsx` is the worked example) and pass
   your OWN domain vocabulary as the `logStep` labels — the shell owns the state
   machine and the chrome, never the wording. Do not fork it: every failure mode
   here is silent (`useRecording` returns inert no-ops outside a provider,
   `logStep` early-returns while idle), so a broken private copy still compiles and
   renders and is discovered on stage.
   `getDemonstratedCode()` derives from the last **coded** step, so the call that
   narrates the filing is also the call that surfaces the code:
   `logStep("Filed the policy exception", code)`. That derivation only survives if
   the demonstration's OUTER bracket stays open from "start recording" until the
   operator says they are done — a nested bracket is fine, but letting the
   ref-count reach zero mid-demonstration clears the feed and strands the code.
5. **Save → recall → replay on a _different_ instance.** The case you taught it
   on is already resolved by the demonstration, so seed **at least two** gated
   records. The proof is it handling the second one unaided.

**Banking's HITL chain:** `offerWorkflowRecording` (`tools.tsx:1101`) →
`awaitDashboardDemonstration` (`1176`, live pulsing "Rec" badge + step feed) →
`saveLearnedWorkflow` (`1258`, then `save_memory` with scope `project` — the one
exception, do NOT copy it; see the scope box under "Seeding memories" —
kind `operational`) → replay via `openPolicyException` (`907`) →
`finalizePolicyException` (`975`) → `approveTransaction` (`1035`). Line numbers
drift with every edit to that file — grep the tool NAME, which is stable.

**⚠️ Runtime-conditional.** Gate → unlock is provable over pure REST today
(`docs/teach-mode/verify-teachable-gate.sh`). Durable save → recall → _fresh
thread_ needs Intelligence. `pnpm test:self-learning` covers it deterministically
via aimock.

---

## Seeding memories (load-bearing for beats 4, 5 and 6)

Beats 4 and 5 are **seeded, not emergent** — "it already knows me" is a file. Add
`src/skins/<id>/intelligence/seed-memories.ts` alongside your `user-id.ts` and
mirror `src/skins/banking/intelligence/seed-memories.ts`. Four rules:

- **Seed the topical preference** (beat 4) and the **operational procedure**
  (beat 5).
- **Deliberately do NOT seed beat 6's procedure.** That is the one the agent must
  learn on stage. Banking's seed file omits it on purpose
  (`seed-memories.ts:53-60`) — if you seed it, beat 6 has nothing to teach.
- **Word beat 5's procedure and beat 6's so they can never be mistaken for each
  other**, and force the distinction in both prompt clauses too. This is the single
  easiest thing in the demo for the agent to confuse.
- **Seed the DEFAULT bucket, not only the mapped person's.** A run usually
  resolves to your `DEMO_DEFAULT_USER_ID`, so seeding only the mapped id leaves
  `recall_memory` reading an EMPTY bucket — worse than a degraded beat, because
  the agent gives no answer rather than a generic one while the memory sits
  perfectly well stored one id over. Banking seeds only its default bucket; the
  rest seed it alongside the mapped one, deduped through a `Set` so a pinned
  `INTELLIGENCE_USER_ID` is not double-written
  (`grep -rn 'SeedTargetUserIds\|SEED_TARGET_USER_IDS' src/skins/*/intelligence/user-id.ts`).
  Derive that list in `user-id.ts`, never in the reset route — templates.md
  § "Do NOT hardcode the bucket list" explains why.

### 🚨 Scope BOTH procedures `user`. Not `project`.

**`project` scope survives every presenter reset, so a project-scoped learned
procedure means beat 6 opens ALREADY TAUGHT on the second run of the day** — the
agent clears the gate unaided, the room sees no failure, and there is nothing to
demonstrate. Nothing errors; the beat just silently stops existing.

The mechanism, and the reason the two halves must agree. Project scope is **global
to the shared Intelligence instance**, and every skin in this app points at one, so
a sweep that deletes project rows would delete a SIBLING skin's seeds. Every skin
bar banking therefore ships a `forget-memories.ts` that skips them —

```bash
grep -ln 'scope !== "project"' src/skins/*/intelligence/forget-memories.ts
```

— and in such a skin the reset physically CANNOT clear what beat 6 taught if beat 6
saved it at project scope. Copy that sweep (you should) and then save at project
scope, and you have built the failure.

A project-scoped memory is returned for EVERY user id, so it also leaks across
products — one skin's procedure recalled inside another reads to the room like
the memory system confused two applications.

**`banking` scopes its learned procedure `project`. It is the one exception, not
the pattern**, and it gets away with it only because its own sweep deletes every
row including project ones — self-consistent, and the reason it is safe there is
exactly the reason it is not safe anywhere else. Every other skin scopes `user`,
and each seed file records why in a comment beside the field:
`grep -n 'scope:' src/skins/*/intelligence/seed-memories.ts`.

Keeping beat 5's seeded procedure and beat 6's learned one distinguishable is then
a job for their TEXT and the prompt clauses that route to them — each says plainly
that it is not the other — not for the scope field.

Reset must re-seed. See the Reset requirement below.

---

## Presentation requirements (not beats, still mandatory)

**A pill for every beat, in demo order.** The presenter should never type — "make
sure that the bubbles are in there so I never have to type, I could just click."
This is also a correctness measure: free-typed phrasing routes wrong. Saying
"show me the spending **report**" instead of "trend" sends banking to the canvas
report tool rather than the in-chat chart. Pills remove that whole class of
stage accident. **Derive the count from your beat map, never from a target
number:** one pill per beat, in demo order, skipping only beat 2 (which is
demonstrated by reloading the browser). That is the base formula, and it lands on
eight.

Add a ninth pill only when your canvas brief needs an ask of its own — having a
`CanvasSurface` is not by itself a ninth pill. `people` and `commerce` do give the
brief its own pill (row `(canvas)` in their beat maps, pill 9). `banking` has a
`CanvasSurface` too and still ships eight, because its beat-3d pill ("Prep the Q2
spend report") both ingests the invoice AND files the canvas report, so the brief
rides along instead of asking twice.

Read the beat-map header at the top of `people`'s or `commerce`'s `suggestions.ts`
to see the mapping written out, and count what any skin actually ships with
`grep -c 'title:' src/skins/*/suggestions.ts` rather than trusting a number in
prose. **Nearly every shipped skin is demo-complete and the counts still disagree
with each other** — that is the whole point: a count says nothing about coverage in
either direction. The highest count in the tree belongs to a skin whose extra
pills map to no beat at all (the arithmetic is written out at the top of its
`suggestions.ts`). Derive coverage from the matrix commands in `CLAUDE.md`, never
from a pill count.

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
leaving beat 6 unlearned. Banking's `dev/reset` route does exactly that.

**The route and the button are one feature — ship both or neither counts.** Every
skin that has one has the other, and the pair is DERIVABLE rather than listed
here: `ls -d src/app/api/*/v1/dev/reset` and `grep -rln usePresenterReset
src/skins/` return the same set. Run both commands rather than trusting any
sentence — a new skin is expected to appear in both.

The **memory** half is a second, narrower question, and it is derivable too:
`ls src/skins/*/intelligence/seed-memories.ts` names every skin whose reset can
re-arm beats 4–6, each alongside a sibling `forget-memories.ts`. A skin with a
reset route but no seed file restores its data store only and CANNOT reset those
beats — a silent trap, because its Reset button looks identical.

A `useData` skin inverts the data half: with no server-side store there is nothing
to restore, so its route touches memory only and the button clears the browser
state itself before reloading (`bookstore`'s `localStorage` cart is the worked
example). It still owes you the memory half.

Treat the route, the button and the re-seed as required: without all three you
cannot re-run the demo for the second room in the day.

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
supply chain / logistics (shipped), HR and people operations (shipped as
`people`), retail merchandising and commerce operations (shipped as `commerce`),
insurance claims, field service, recruiting, legal contract review, energy and
utilities operations, customer-support command centers, manufacturing quality.

**The bar is "holy shit" pretty, not "renders correctly."** Arm sales with
something beautiful and they close monster deals; ship template output and the
beats land flat no matter how correct the wiring is. Budget real design effort,
and use the workspace's frontend-design skill rather than eyeballing it.

**And "renders correctly" is a weaker floor than it sounds.** A skin's failures
are almost never crashes — they are **confident falsehoods**: a beat that renders
beautifully, narrates fluently and proves nothing, which nobody in the room can
distinguish from the beat working. Each beat above therefore has a lie-shaped
failure mode as well as a broken one, and the ones this app has actually shipped
are collected in [failure-modes.md](./failure-modes.md) — read it before writing
tools or pages, alongside this file.

---

## Which skin to copy for what

**Every registered skin but `bookstore` is demo-complete**, so the question is
usually not "which ones are finished" but "which one is the cleanest read for the
thing I am stuck on". Rows naming a set rather than a skin give you the derivation
instead, because a set rots and a command does not.

| Need                                      | Copy from                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Every beat, end to end                    | any registered skin but `bookstore` — pick the domain nearest yours                   |
| A written-out beat map                    | `people`, `commerce` or `bookstore` — the table atop their `suggestions.ts`           |
| A map with DELIBERATE gaps                | `bookstore` — two rows marked `SKIPPED`, each with its reason                         |
| A customer-facing (not console) skin      | `bookstore` (a shopper's storefront) or `airline` (a traveller's concierge)           |
| Route + on-screen readables (beat 3b)     | `grep -rln useAgentContext src/skins/*/layout.tsx` — all of them; `banking` richest   |
| Teach mode (beat 6)                       | `docs/teach-mode/README.md` first; then any skin shipping `teach-mode-directives.ts`  |
| A four-lever navigation (beat 3c)         | `commerce` — status + exception + sort + top-N, all four tinted                       |
| Attachment staging (beat 3d)              | `@/shell/attach` for the chain; any skin's `attach-*.ts` for the pill                 |
| A GENERATED uploaded document             | `@/shell/documents` for the bytes; `commerce`/`people`/`logistics` for the content    |
| Seeded memories (beats 4, 5)              | `ls src/skins/*/intelligence/seed-memories.ts` — copy any one that scopes `user`      |
| Debugged layout + meta-utility strip      | `logistics`, `people`, `commerce`                                                     |
| Server-emitted a2ui canvas                | `logistics` (`renderBrief`), `banking` (`render_report`)                              |
| Per-user identity plumbing                | `ls src/skins/*/intelligence/user-id.ts` — all of them; `commerce`'s is the `Map` one |
| Runtime identity with NO context to read  | `airline` — `useRuntimeProperties` + `identifyUser`, no `RuntimeProviders`            |
| Parameterized routes in `resolvePage`     | `keel` (`knowledge/<docId>`, `runs/<runId>`), `bookstore` (`book/<slug>`)             |
| A server-settled clock (no client tick)   | `keel` — `src/app/api/keel/v1/settle-runs.ts`, settled on every read                  |
| Raising an EXISTING skin to the beats     | `logistics`, `airline`, `keel` — their git history walks that path commit by commit   |
| A gate that is ENTITLEMENT, not authority | `airline` — the fare's own conditions refuse; the exception must MATCH the record     |
| An in-memory `useData` substrate          | `bookstore` — the only implementor; seed catalog + a `localStorage` cart mirror       |

> **Generating a PDF? Do NOT write the bytes — call `@/shell/documents`.**
> `buildPdf(lines: Line[])` emits a single page of base-14 text with a correct
> xref, and your file supplies CONTENT only. Both shipped builders
> (`commerce/data/price-sheet-pdf.ts`, `people/data/offer-letter-pdf.ts`,
> `logistics/data/rate-sheet-pdf.ts`) are nothing but content, and they are
> the shape to copy.
>
> The three traps below are FIXED IN THE PRIMITIVE, so you inherit all three. They
> are still written down, because each produces a VALID PDF that is wrong on screen
> — nothing type-checks a rendered page, this document is projected at exactly the
> moment the room is looking, and the second is only half solvable centrally (the
> half that is yours is named there, and the same split applies to the third).
>
> 1. **Encoding — handled for you.** The page declares base-14 fonts (WinAnsi, one
>    byte per glyph) while the content stream is written with `TextEncoder`
>    (UTF-8), so a single em dash goes out as three bytes: the reader shows
>    mojibake AND the `/Length` computed from JS string length no longer matches
>    the byte count. `buildPdf` runs `toAscii` on every text path, which
>    NFD-normalizes and drops combining marks (so `Inés Vidal` transliterates to
>    `Ines Vidal` rather than becoming `In?s Vidal`), folds typographic
>    punctuation, and leaves a visible `?` only where there is no ASCII base at all
>    (CJK, a currency symbol) — a dropped character is a silent corruption, a `?`
>    is a legible one.
>
>    It is centralized because a per-skin copy of the byte layout gets it wrong in
>    two independent ways — no fold at all (mojibake plus a `/Length` that
>    disagrees with the bytes, on any seed carrying `Inés Vidal` or `Montréal`),
>    and a fold that covers punctuation only (`?MILE & FILS`). **Do not
>    rediscover either.**
>
>    **If you ever do write bytes yourself, PIN the fold with a test or your
>    byte-layout assertions are decorative.** Once the document is ASCII,
>    characters and bytes are the same thing, so a test that checks `/Length` or an
>    xref offset against a `TextDecoder().decode()` string passes for the same
>    reason the builder is correct — and would desync in step with the builder if
>    the fold were ever relaxed, so it can never fail for the case it exists to
>    catch. Two cheap habits close it: build from input carrying an accent, a curly
>    quote and an em dash and assert every emitted byte is `< 0x80`; and decode with
>    `new TextDecoder("latin1")` (one byte, one character) wherever an assertion is
>    about byte offsets rather than glyphs. `src/shell/documents/pdf.test.ts` is the
>    worked version; `offer-letter-pdf.test.ts` and `price-sheet-pdf.layout.test.ts`
>    § "ASCII invariant" re-run the byte check over each skin's own content.
>
> 2. **Alignment — half yours.** Any table spaced with `padEnd` is aligned by
>    CHARACTER COUNT, which is only true in a MONOSPACED font. Drawn in Helvetica,
>    every row starts its next column somewhere new and the table renders visibly
>    ragged. The primitive's answer is Courier: `mono` on a `Line` selects `/F3`
>    Courier or `/F4` Courier-Bold, and its 600/1000-em advance turns both
>    alignment and the page-fit bound into arithmetic on character counts, which
>    `PDF_METRICS` (`monoAdvance`, `drawableWidth`) publishes so you can assert
>    them.
>
>    **What the shell's test cannot know is your content**: whether YOUR columnar
>    lines actually set `mono`, and whether YOUR column widths fit inside
>    `drawableWidth`. Drop the flag or widen a column and the shell's suite stays
>    green while the table renders ragged or runs off the page. Commerce keeps a
>    test for each (`price-sheet-pdf.layout.test.ts`); copy both.
>
> 3. **Wrapping — handled for you, for PROSE only.** A writer that does not
>    measure as it draws lets a line that does not fit run off the right margin,
>    and the reader clips it. Survivable for literals an author eyeballs once; a
>    live trap for sentences you DERIVE, whose length is not knowable when they are
>    written — a 111-character sentence runs a third of the way off the page, in the
>    one paragraph the agent reads aloud.
>    `buildPdf` wraps every non-`mono` line on word boundaries before drawing,
>    so hand your sentences over whole and do not bound them yourself.
>
>    Two things to keep in mind. **It measures the ESCAPED, FOLDED string**, which
>    is why the wrap cannot live in your skin: `pdfEscape` turns one `(` into two
>    characters and `toAscii` turns one `…` into three, so a budget checked against
>    the raw text is wrong by exactly the amount a punctuation-heavy sentence needs
>    it to be right — and `pdfEscape` is private to the writer. **`mono` lines are
>    exempt**, and
>    must be: wrapping a columnar line would break the character-count alignment it
>    exists to keep, so a `mono` line that does not fit is still yours to bound
>    against `PDF_METRICS` / `charBudget`.
>
>    The budget is approximate in one direction: prose is Helvetica, whose advances
>    vary per glyph, so Courier's 600/1000 is a conservative stand-in — NOT a bound
>    for ALL-CAPS text, so keep shouted words short. If you want the belt-and-braces
>    check, assert on the EMITTED bytes: parse the content stream's `Tf`/`Tj` pairs
>    and check every drawn line against `charBudget(size)`
>    (`logistics/data/rate-sheet-pdf.test.ts`), which catches your hand-typed
>    literals too.

> **Generating a document? Every sentence in it must be DERIVED from its own
> rows.** The agent lifts facts out of this file and narrates them, so a claim the
> document's own numbers contradict comes back as something the assistant asserts
> to the room. A hardcoded "Driven by merino price" sits under a rise the route put
> on two non-merino styles while quoting the only merino SKU flat.
> Do not name a material, a cause, or a direction of change that you did not
> compute from the rows — the row set is usually parameterized (commerce's vendor
> is a query parameter), so today's shape is not tomorrow's. See
> `costMovementLines` in `commerce/data/price-sheet-pdf.ts` and its test.

> **And every ROW has to belong to the party the document is addressed to.** The
> same defect one level down from the sentence above, and easier to ship: beat 3d
> wants one row the app's own data cannot supply (that is what proves the file was
> read rather than politely acknowledged), and the cheap way to get it is to append
> a fixed row. One hard-coded "Alder Crewneck" on EVERY vendor's price sheet means
> `?vendor=Ardent%20Leather` hands the model a leather-goods supplier quoting a
> knit crewneck — a supplier relationship that does not exist, asserted by us and
> narrated by the assistant. Key the invented row by whatever
> parameterizes the document and check it against the LIVE data before emitting it
> (`commerce/data/price-sheet-styles.ts`: one entry per vendor, each in a category
> that vendor actually supplies, re-checked against the vendor's own rows, and
> DROPPED rather than misattributed when a reseed moves them). Losing the row for
> one party is recoverable; a false claim about them is not.

> **And the artifact must not contradict the document it was filed from.** The
> tool that files the record is the last place this beat can go wrong, and it goes
> wrong through an OPTIONAL parameter: a model fills one anyway. Logistics'
> `fileRateBrief` has an optional `oldRateUsdPerKg` documented as "omit for a lane
> the sheet prints as new", and a run that copies the QUOTED rate into it renders
> "$0.49 → $0.49, flat" for the one lane the attached sheet prints as new service
> with no prior rate on file. The record contradicts the document it was filed
> from, on exactly the row that proves the document was read.
>
> **Screening the direction you observed is not enough** — the field goes wrong in
> three, and all three put the same lie on the same row. OVER-FILLED is the one
> above. UNDER-FILLED is its mirror: omit the field for a lane the ledger DOES
> carry and the card labels the row "new lane", telling the room the app has never
> carried a lane it carries. WRONG is the third: `oldRateUsdPerKg: 9.99` stored
> verbatim renders "down 94.8%" beside a document printing "up 15.6%".
>
> Prompt wording does not close any of them. Split the fields by WHO OWNS THE FACT
> and let the server SETTLE its own, in every direction: the NEW figure comes from
> the document and only a reader of the attachment knows it, so it stays
> model-authored (that is the beat's proof); the PRIOR figure is a ledger fact, so
> the route overwrites it from the ledger on a unique match, drops it when there is
> no match (absence of the row IS the answer), and — only where the app genuinely
> cannot tell which record the document meant — leaves the model's reading standing
> and SAYS SO. `POST /briefs` (`app/api/logistics/v1/briefs/route.ts`) returns both
> lists so the tool can tell the agent rather than silently overrule it. Note `??`
> is not settlement: it repairs the under-filled case and stores the wrong one.
>
> **Scope the match by whatever the document is a statement ABOUT**, which is
> usually also what removes the ambiguity that tempts you to settle one direction
> only. Matched network-wide, `SHA-LAX` + `ocean` hits two different lanes at two
> different rates and looks unsettleable. A rate sheet
> is one CARRIER's quote, and per carrier the match is unique on every seeded pair.
> The scoping is not a trick to dodge the ambiguity, it is the more honest reading:
> a rate another carrier gets is not a rate you hold with this one.
>
> This is the same rule `POST /decisions` already applies to `decidedBy` and the
> mitigate route applies to cost, extended to the one field a document ingestion
> adds.

**Every registered skin is demo-complete, so there is no partial precedent to
copy.** The failure to guard against instead is this one: **full per-user identity
plumbing — `RuntimeProviders`, `useRuntimeProperties`, server `identifyUser` — with
no memory prompts, no memory tools and no seed file, so the skin gets ZERO demo
value from the hardest part of what it already built.** Wiring the expensive half
and skipping the cheap half is the characteristic way a skin ends up technically
impressive and demo-worthless, and it is invisible in a diff: everything compiles,
everything renders, and the beat simply is not there. If you find yourself building
identity plumbing, build the seed file in the same phase.

Check every claim on this page against the tree
(`ls src/skins/*/intelligence/seed-memories.ts`,
`grep -c 'title:' src/skins/*/suggestions.ts`) rather than against the prose.
