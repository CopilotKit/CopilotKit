# Failure modes — how a skin lies

Read this before you write tools or pages. It is not a bug list; the per-file
traps live in [templates.md](./templates.md) and this file cross-links to them.
It is the set of ideas you need up front, because each one changes a decision you
make while writing, and none of them belongs to a single file.

Each section is a CLASS, not a bug. The classes are what generalise; the
individual instances behind them do not.

---

## The through-line

> **A demo skin's characteristic bug is not a crash — it is a confident
> falsehood. A crash is visible on stage and gets fixed. A convincing lie reads
> as success and proves nothing.**

CLAUDE.md already says this about beat 3d ("the demo appears to work and proves
nothing"). It is not a property of beat 3d. It is the shape of nearly every defect
worth catching in a skin, and it is why the ordinary quality bar is not enough
here.

Ordinary software fails toward noise: an exception, a red box, a 500. This app
fails toward **plausibility**, because almost everything it does is _describe
something_ — a card in the transcript, a readable handed to a model, a receipt
line, a generated panel, a PDF that gets projected. A description does not throw
when it is wrong. It renders, in the house style, at the exact moment a Fortune
500 buyer is looking at it, and the presenter is the last person in the room who
can tell.

Three consequences to carry through everything below:

1. **"It compiles, lints and passes tests" is not evidence of anything you care
   about.** Every class in this file did all three.
2. **The demo is the test suite for the properties nothing else checks.** Which
   means beats you never walk are properties you never checked — see SKILL.md
   § "Then walk the demo".
3. **Prefer visible ignorance to invisible confidence.** A muted "still
   arriving…" card, a caveat sentence, a `null` — every one of those is a better
   outcome than a figure you cannot stand behind. This trade shows up in half the
   sections below and the answer is always the same direction.

---

## The other organising idea: three audiences, three obligations

A skin publishes facts to three audiences, and they have **different** obligations.
Collapsing them is how several of these classes happened.

| Audience                          | Reads                  | Obligation                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The screen** — a human watching | Pixels                 | Unknown must be VISIBLY unknown. Not green, not red, and not a bare figure in neutral ink either — an uncaveated number reads as "checked, fine".                                                                              |
| **An agent readable** — the model | Your JSON              | `null`, never `false`. The model cannot see what you omitted, so it cannot discount it. It will restate your `false` as an all-clear, in prose, out loud.                                                                      |
| **A sandbox function / OGUI**     | Rows it did not choose | Send a COMPLETE list whose rows describe themselves. A filtered list is worse than a declared unknown: generated UI can only report what it was handed, and a dropped row is indistinguishable from a row that does not exist. |

Commerce's floor vocabulary is the worked example of all three at once, and
`src/skins/commerce/floor-unknown.test.tsx` pins them apart deliberately — its
header names the three obligations as "three different lies". Read that file
before designing any verdict your skin publishes.

---

## 1. "Unknown" is not `false`, `0`, or an empty list

A category with no margin floor recorded is not a category that passed. A SKU
whose floor could not be looked up is not a compliant SKU. Publishing `false`
there does not mean "no data" to anybody downstream — it means **"checked, and
fine"**, which is the strongest claim your skin makes about that record and the
one it has the least right to.

And the missing-data state is **reachable, not theoretical**. In a REST-backed
skin the ledger arrives through an unvalidated cast, the provider mounts children
on a FAILED first fetch with empty collections, a report hook falls back to empty
outside its provider, the sandbox snapshot starts empty, and any two hand-written
constant lists (`CATEGORIES` vs `SEED_FLOORS`) can disagree with no drift guard.
Every one of those routes to "I have no fact here" while your types still say
`boolean`.

**The shipped pattern** is a tri-state plus two wire forms, all in
`src/skins/commerce/data/derive.ts`:

- `FloorStatus` — `"below" | "clear" | "unknown"`, with `productFloorStatus` /
  `promotionFloorStatus` producing it. The type is what makes forgetting the third
  case a compile error instead of a rounding decision.
- `nullableBelowFloor(status)` — the readable/DTO form: `boolean | null`, never
  `false` for unknown.
- `tallyFloorStatus` → a `FloorTally` with `below` / `clear` / **`unknown`** as
  separate counts, so a green `0` cannot mean "we did not look", plus
  `noFloorCaveat(unknown, noun)` returning the caveat sentence or `null` — the
  count and its caveat come off ONE derivation, so they can never disagree.
- `FLOOR_WORKLIST_RANK` — even the SORT order has to place unknown somewhere
  explicit, or two surfaces will each invent a different place for it.

`src/skins/commerce/sandbox-functions.ts` shows the third-audience decision
worked out in a comment worth reading: its range filter was renamed
`belowFloorOnly` → `notClearingFloorOnly` and **includes** the unmeasurable rows
(already `belowFloor: null`) rather than dropping them, because "a complete list
whose rows describe themselves is the only shape the model can report truthfully".
Note the second half of that fix: the schema is `.strict()`, so a call still
carrying the OLD key is REFUSED rather than silently losing its filter — a rename
without `.strict()` is the same defect one layer down.

⚠ **The reach of the fix is the whole lesson.** Introducing the tri-state and
updating the obvious consumers is not enough: of commerce's **33** floor-fact
consumers, 16 were caught that way, **9 more** — a card sort order, a missing
on-screen caveat, a book-scope confusion, a third private rank table — needed the
full enumeration, and 20 were already honest. The vocabulary is the easy half; its
REACH is the half that gets missed. If you introduce a tri-state, grep for every
consumer of the old boolean and write the list down. See § 11.

---

## 2. Gen-UI renders run mid-stream, with partial arguments

`useComponent`'s `render` is invoked from the FIRST frame of its tool call. It is
handed `partialJSONParse(toolCall.function.arguments)` verbatim, which is `{}`
until the first field closes. So **every** argument is `undefined` for some of the
renders it appears in, including the ones your schema declares REQUIRED —
`.optional()` is not what makes a field absent, and `.strict()` cannot help you.

There are **two** failure modes here and one guard fixes only one of them:

- **It THROWS.** `orderIds.map(…)`, `list.length`, `id.replace(…)` on an argument
  that has not arrived is a TypeError **inside React render** — a blank crash on
  beat 1, the beat the demo opens with. Remember the CONTENTS too: a half-streamed
  `["` parses to `[""]`, and a value can arrive as a non-string.
- **It LIES.** Formatting an absent value into a confident label asserts on screen
  a choice the agent has not made: a Sort chip reading "Sort · oldest first" over
  an unset lever, a lookup card flashing a red "nothing matches ''" before its
  needle arrives, a beat-4 "why" band drawn as an empty coloured bar while its note
  streams. Every one of those renders, in the house style, and then **flips** when
  the real value lands.

The honest state is neither a default nor an empty return. A default asserts a
choice nobody made; returning nothing is worse television than a placeholder,
because beat 1 leads with generative UI and the room is watching it appear. So:
one muted card that claims **only what has arrived**, with the confident branch (a
miss, a receipt, a label) reserved for arguments that actually landed.

**The shipped pattern** is two small helpers in `src/skins/commerce/tools.tsx`,
whose header comment states the rule: `ArrivingCard` (the muted placeholder) and
`arrivedText(value)` (the trimmed string an argument holds once it has arrived, or
`null` — covering absent, blank AND not-yet-a-string in one predicate). The
no-invented-defaults standard for lever chips is
`src/skins/commerce/order-queue-levers.ts`: `normalizeQueueLevers` produces ONE
record that both `queueLeverChips` and `queueLeverQuery` read, and an unset lever
gets **no chip at all**. `src/skins/commerce/streaming-args.test.tsx` red-greens
each render at absent / partial / complete.

Related, one degree worse, and covered in SKILL.md § "Registering tools": a
render-only tool has **no handler**, so core posts an empty tool result and there
is no string with which to correct the model. Enumerate the parameter to its real
domain AND resolve it in the render —
`src/skins/commerce/category-argument.ts`'s `resolveCategoryScope` is the worked
example, including the third state that a streaming argument forces: a value that
is still a PREFIX of a real member is "not arrived yet", not a refusal.

⚠ Walk EVERY render field by field, not the ones a finding names: in commerce, 4
reported sites became **9** across all **19** renders, three of them confident
receipt LINES — `goes live at % off`, `Waiver id undefined`, and
`Finalized the  margin waiver.` (note the double space). Handler strings stream too.

---

## 3. Every write control needs four things, and the fourth is the one people miss

For every control a presenter can click that writes:

1. **Refuse a concurrent second fire** — with a REF, not only `useState`. Two
   clicks dispatched before React commits `disabled` both read the same
   `busy === null` out of their closure.
2. **Disable while in flight**, so the refusal is visible rather than merely
   correct.
3. **Restore in a `finally`**, so no rejection can latch the button on
   "Issuing…" for the rest of the demo with no way back but a reload.
4. **Distinguish "the write FAILED" from "the write LANDED but the re-read
   failed."**

That fourth case is the one that keeps shipping, and it is only ever found by
looking for it deliberately. Treating a landed write as a failure re-arms the control and
invites a duplicate write. On the money path that is **a second refund for money
that already moved**. Report it as "it happened, and the page is behind", and
**LOCK** the control rather than re-arming it — on a failed re-read the row still
shows its old status, so the control is still on screen and still inviting.

Why the stakes are different here than in ordinary software: a normal user who
sees a spurious failure retries, shrugs, or files a ticket. A presenter on stage
has exactly one recourse — **do it again**. So a false refusal is not a cosmetic
defect, it is a mechanism for producing the duplicate write.

**The shipped pattern:** `useInFlight` in
`src/skins/commerce/components/use-in-flight.ts` (ref mutex + visible `busy` +
`try/catch/finally`, resolving "did this write LAND" and never rejecting);
`narrateWrite`, `staleNote` and `STALE_VIEW_NOTE` in
`src/skins/commerce/settle.ts` for the three-outcome receipt; and the
`RefundOutcome` type in `src/skins/commerce/pages/returns.tsx`, which is what
splits landed money from a stale view on the surface that matters most. Rule 5 of
templates.md § "REST-backed instead?" carries the scaffold and the testing notes —
including that jsdom does **not** dispatch a click to a `disabled` button, so a
rendered double-click only ever proves the visible half.

**Granularity is a demo requirement, not just a correctness one.** Two rules that
pull in opposite directions and both have to hold:

- A guard must be **at least as coarse as the MESSAGE CHANNEL** its writes share.
  Two controls reporting into one error slot must share one guard, or whichever
  write finishes last speaks for both and a refusal is erased by an unrelated
  success — the same silent no-op, reached through the report instead of the
  request.
- But coarser is **not** automatically safer. A page-wide mutex would be correct
  and would stop a presenter holding two orders in quick succession — turning a
  correctness fix into a demo regression. **Split the message slot per record
  first, then mount the guard to match it.** Commerce ended up with one guard per
  promotion CARD, one per orders ROW, and one per returns PAGE, each because of
  its slot; `use-in-flight.ts`'s header explains all three.

---

## 4. If you drive the framework's own DOM, confirm the effect — never assume it

Beat 3d stages a file into the composer and clicks send, because the framework's
suggestion path drops attachments. That means a chain of REQUESTS made of code you
do not own, and **an unobserved step is an assumption**. There are at least six
independent ways for the chain to report success having achieved nothing — and the
whole point of the beat is the claim "it read a real document", so a silent failure
makes the model INVENT the document's contents, your tool file the artifact anyway,
and the beat prove the exact opposite of what it says while reading perfectly.

Three rules, in order of how often they are skipped:

- **Reporting a failure is the easy half; DETECTING it is the half that gets
  skipped.** Hardening the error path while every failure still resolves `true` is
  the version of this that ships.
- **A fixed sleep is not a confirmation.** It races an async encode: a 500 ms wait
  that then returns success reports a green light at ~564 ms on every one of the
  failure paths below. Wait on a **CONDITION with a bounded budget**, and treat an
  expired budget as a failure, not a green light.
- **Read the framework's source for the observable signals**, and be specific:
  file accepted vs silently rejected (`processFiles` drops anything failing
  `accept`/`maxSize` and calls an `onUploadFailed` nobody wires), encoding
  finished, send button in SEND vs STOP vs disabled (one button plays both roles,
  so mid-run a click CANCELS the run), and the click itself confirmable.

⚠ **If no signal exists for one of them, fail CLOSED and say so in a comment.**

**You do not have to build this — call it.** The chain is shell-owned:
`stageAttachment` / `attachByHand` / `sendMessageWithAttachment` in
`src/shell/attach/stage-attachment.ts`, exported from `@/shell/attach`. It
established from source that no `ready` status attribute exists AT ALL, so it uses
a filename-in-queue proxy, documents that it is a proxy, and makes the bounded
wait around it fail closed — rather than quietly assuming success on the one step
it could not observe. Everything else it does verify: `%PDF` magic bytes rather
than a 2xx, acceptance by a chip appearing in the queue, and the send by the
attachment LEAVING the queue. It classifies fifteen distinct causes, because "a
presenter needs to know whether to retry, press send by hand, or restart the dev
server", and unlike the per-skin copy it was extracted from, **all fifteen are now
actually emitted by the code and driven by a test** —
`src/shell/attach/stage-attachment.test.ts` reads its expected count off a
`Record<AttachmentFailureCause, true>`, so a member added to the union and never
driven fails `tsc` and then fails the count. The full failure table is in
demo-beats.md § 3d.

⚠ **There is ONE implementation, and every skin that runs this beat is a ~45-line
wrapper over it.** A per-skin copy is how you get a `stage…Attachment` that
dispatches `change` and returns `true`, and a sender whose staging result gates a
500 ms sleep AND NOTHING ELSE — so a failed stage still sends the prompt, the model
invents the document, and the artifact is filed anyway. **If you find yourself
copying a staging chain into a new skin, stop: you are recreating the defect.**

---

## 5. Redact from an env-derived secret SET, not from one argument

Anything presenter-facing that echoes backend text — a `dev/reset` response body,
an error surfaced in an alert, a `memoryError` sentence — has to be scrubbed
against **every** secret the environment holds, derived from the environment
itself.

A redactor that takes one secret as an argument is a redactor that will miss the
next one. A `redactBackend(text, apiUrl)` scrubs the backend URL faithfully and
**leaks the API key verbatim, five times over, in a single response body** — a
presenter-facing body, on a control a presenter clicks. Commerce's environment
holds five such needles, not the two an obvious reading finds.

**The shipped pattern** is `src/lib/redact-secrets.ts`: `envSecretNeedles()`
derives the needle set from the environment (including the easily-missed portless
`URL.hostname`), and `redactSecrets` applies it. Two design points worth copying:

- **Per-secret placeholders that preserve diagnosis.** A body reading
  `HTTP 401 <intelligence-api-key>` still tells a presenter what failed; a blanket
  `[redacted]` does not, and a message that cannot diagnose gets replaced by
  someone echoing the raw text again.
- **An explicit DELIBERATELY-ABSENT list, with reasons**, in the module header —
  a public signing key, and two values that are not secrets. That is the whole
  difference between a justified subset and a silent one, and a silent subset is
  exactly what the one-argument version was.

⚠ Also: route every NEW echo path through it — an unrelated field like
`failed[].reason` reintroduces the class through a new path. And `banking` and
`people` have this class today (an unredacted `memoryError` plus an echoed
`apiUrl`) — do not copy their reset routes.

---

## 6. A guard you never tried to fool is not a guard

Two rules, and the second is the sharper one.

**Validate a check against content it must NOT flag, not only content it must.**
"Zero false positives on today's tree" proves that no CURRENT sentence trips your
rule — not that no LEGITIMATE sentence does; the tree simply may not contain the
shapes that break it. `src/shell/skin-roster-docs.test.ts` is the worked answer:
it pins **must-flag AND must-not-flag fixtures** for each discriminator, so neither
can be quietly widened back, and its header names the two truthful shapes ("the
sixth skin", a deliberate partial glob) that a must-flag-only version rejects.

**And when a check PASSES, ask where its premise came from.** If the premise came
out of the artifact under test, the check agrees with the bug. Three shapes:

- A WCAG contrast assertion measuring the wrong background — the chip renders on a
  12% tint, the guard measures the card: 4.52:1 (pass) against 3.75:1 (fail) on
  the ground the user actually sees. And the same false justification tends to sit
  in `design-skill.ts`, instructing GENERATED UIs to use a colour that fails AA.
  Fix **the colour, not the assertion** — the lazy fix here is always to move the
  goalposts. See `src/skins/commerce/theme.test.ts`, whose pairs composite an
  alpha ground before measuring and DERIVE their render sites from grep patterns
  that fail when a pattern finds nothing.
- PDF `/Length` and xref byte offsets asserted in **decoded characters**, so the
  multi-byte desync the file exists to catch can never fail them. Those assertions
  cannot fail today for a reason they do not name: `toAscii` makes characters and
  bytes the same thing. **The load-bearing premise is `toAscii`, so assert THAT** —
  relax the fold and the byte assertions go on passing while the PDF breaks.
  `src/shell/documents/pdf.test.ts` pins it, building from accented input and
  asserting every emitted byte is `< 0x80`; the fold and the byte layout both live
  in that primitive, so the guard is written once and inherited by every skin that
  generates a document. Each skin re-runs the byte check over its own content
  (`price-sheet-pdf.layout.test.ts` § "ASCII invariant", `offer-letter-pdf.test.ts`).

  Two corollaries. Pinning a premise is what makes it safe to CHANGE it: a pinned
  fold that turned every accented letter into `?` (`In?s Vidal`, `?MILE & FILS`)
  could be widened to transliterate as a two-line change with the blast radius
  visible in the diff. **A test that pins the wrong behaviour is still worth more
  than no test; just do not mistake "asserted" for "correct" when you read one.**
  And arguing about whether a passing check is "really" wrong is the wrong
  argument — find the premise the pass depends on and assert that instead.

- `npx prettier --check` reporting "All matched files use Prettier code style!" on
  `templates.md` while two of its `.theme-<id>` placeholders read `.theme-<id >` —
  prettier's CSS parser re-spaces `<id>` inside a fenced `css` block, so **prettier
  considers its own mangled output canonical**. The
  `<!-- prettier-ignore -->` guard in templates.md is what stops it. Do not remove
  it, and guard any new fenced CSS block with placeholders the same way.

---

## 7. Test traps that produce green for the wrong reason

A large green suite is what every gate here relies on for confidence, and it is
routinely weaker than it looks: one review of `commerce` found roughly twenty-two
tests passing while the behaviour they name was wrong or never exercised.

**The general rule: for every assertion, ask what would have to break for this to
go red. If you cannot answer, the test is decoration.** The same question applied
one level up — to the GATES rather than the assertions — is § 13. The concrete,
transferable traps:

- **Vitest `it.each` SPREADS array rows.** An `[]` case therefore runs with NO
  argument — the title prints a literal `%o` — and silently duplicates the
  `undefined` case. The coercion the docstring specifically called out was never
  tested.
- **`expect(...).toBeTruthy()` passes for `[]`**, which is very often the exact
  failure being guarded (here: the blank generated panel).
- **Mocking a `Promise<boolean>` contract as `Promise<void>`** resolves
  `undefined`, which is falsy — so the HAPPY path silently exercises the failure
  branch. `vi.mock` does not type-check its factory against the real module. This
  is the natural companion to § 3: because `refresh()` is
  `Promise<boolean>`, every `async () => {}` mock of it asserts the
  stale-view branch while looking green. (And nothing else catches it
  either — see § 13: no gate in this app type-checks a test file unless you run
  `pnpm exec tsc --noEmit` by hand.)
- **Asserting a byte layout in decoded characters** can never catch a multi-byte
  desync (§ 6).
- **`vi.stubEnv` without `afterEach(vi.unstubAllEnvs)`** leaks into later test
  FILES, not just later tests. `src/skins/banking/intelligence/user-id.test.ts`
  cleans up; commerce's sibling does not.
- **A test that omits the very argument that makes its assertion meaningful**
  cannot fail for its stated reason — e.g. asserting that a recital does not
  inherit another record's history while passing no subject at all, so the lookup
  returns empty regardless.
- **Two tests pinning contradictory contracts for one vocabulary** (one refuses a
  lowercase category, another folds it) — the direct consequence of a hand-copied
  enum with a drift guard on only one copy.
- **A test that pins the wrong behaviour** — blessing a truncation the route
  refuses, or a caption whose grammar is wrong. When a fix requires changing a
  test, check whether the test was the bug.

⚠ Several of these are still live in commerce's test files: they change no shipped
behaviour, so they lose to the merge gate. Treat this section as a list of shapes
to avoid, not as a description of an exemplary suite.

---

## 8. Put a shared helper where a second page can import it

A helper can be entirely correct — ref mutex, `finally`, honest `false` — and
still produce the bug by living **inside a page module**: a hook exported from
`pages/promotions.tsx` does not READ as importable, so the second page that needs
it grows a weaker local copy with no mutex and no `finally`, whose rejecting fetch
wedges a button until the presenter reloads.

`useInFlight` therefore lives in
`src/skins/commerce/components/use-in-flight.ts`, and its header says why in one
line worth stealing: "One definition, every caller."

Two transferable habits:

- Anything two surfaces will plausibly need goes in `components/` (or `data/`, or
  a bare module at the skin root) from the start — not in whichever page needed it
  first. Placement is the origin of most hand-copied-helper defects.
- ⚠ **When you find two divergent copies of a helper, check where the ORIGINAL
  lives before assuming the copier was careless.** The copy is usually a symptom of
  placement, and fixing the copy without moving the original just sets up the third
  copy. Do the move as its OWN commit, separate from the behaviour change — a
  semantic change hidden inside a relocation is unreviewable.

---

## 9. State a claim as an invariant plus the command that proves it

The most common documentation defect in this app is one shape: prose hard-codes a
count or a roster, the set grows, and nothing checks it. "ships four of them",
"these four", a four-value `LOCK_SKIN` list, "all four stay reachable", "the
unlocked four-skin demo" — every one true when written, and one CR pass over
`commerce` found sixteen of them live.

Prose discipline alone does not hold it: CLAUDE.md's standing rule to re-read this
skill after every change predates those sixteen instances and did not prevent them.
So the durable fix is **to replace the fact with its derivation**:

- ❌ "Three skins ship a seed file."
- ✅ "Every demo-complete skin ships one — `ls src/skins/*/intelligence/seed-memories.ts`
  shows which."

Prefer "every registered skin", "each demo-complete skin", "the REST-backed ones",
plus the `ls` / `grep -c` that enumerates them, over any numeral. demo-beats.md
already does this in several places (counting pills with
`grep -c 'title:' src/skins/<id>/suggestions.ts`, and pairing
`ls -d src/app/api/*/v1/dev/reset` with `grep -rln usePresenterReset src/skins/`);
copy that habit into whatever you write.

**There is now a mechanical guard**, `src/shell/skin-roster-docs.test.ts`, which
derives its expectations from `skinIds` and fails on a stale count or a stale
roster in the documents it names. Its boundary, honestly:

- It checks a fixed `DOC_SET`. **This file is not in it** — nor is any other new
  file you add to the skill — so the discipline above is still yours to keep here.
- It deliberately does not check subset counts, per-skin counts (gen-UI
  registrations, pills, beats) or source comments; its header lists two known
  stale instances outside the set. Read that header before assuming a claim is
  covered.

---

## 10. A gate's unlock vocabulary must never reach the agent

This is the ONE place the rule everywhere else in this skill — enumerate every
closed-set parameter with `z.enum(YOUR_CONST_TUPLE)` so the vocabulary reaches
the model — is **inverted**. For a beat-6 gate, the vocabulary reaching the model
IS the defect: an agent holding the codes that lift the gate already knows the
procedure, clears it unaided, and there is nothing left to teach. The demo still
runs, beautifully, and proves nothing.

**The whole mechanism can be right and the answer still given away, four ways
over.** Logistics has the gate (`data/authority.ts`, refusing with the symptom
only), the justifying/decoy split (`data/escalation-codes.ts`) and a 422 that
refuses an uncatalogued code without enumerating the valid set. All four of these
publish the catalogue anyway:

1. a `useAgentContext` readable described as _"Valid escalation codes. Only these
   are accepted"_;
2. `z.enum(ESCALATION_CODES)` on the filing tool's `parameters`;
3. the tool's own `description`: _"a code from the valid escalation-code catalogue
   **in your context**"_;
4. an `agent.ts` RULES line listing "valid escalation codes" among what is
   "provided".

**Closing three of four is closing none.** Deleting the readable while leaving the
description moves the leak into prose; deleting both while the prompt still says
the codes are provided leaves a sentence that is now also false. Enumerate the
channels — readable, schema, tool description, prompt, error body — and record a
verdict for each (§ 11).

🚨 **AND THE LIST OF FIVE IS NOT EXHAUSTIVE — enumerate YOUR skin's channels, not
this file's.** The five above are the ones every skin has. A skin can invent a
sixth, and one did: `airline`'s gate is grounded, so `Booking.waiverGround` holds a
CODE-SHAPED token (`"schedule_change"`, `"medical"`) that maps 1:1 onto a justifying
category. It lives on a record the ledger publishes, so the ledger readable would
have handed the agent half the catalogue sideways — through no readable, schema,
description, prompt or error body. `store.snapshot()` strips the field
(`data/store.ts`'s `toDto`), and three tests pin the strip: `data/store.test.ts`,
`/ledger`'s and `/bookings/[id]`'s route tests, plus a client-side
`tools.test.ts` case asserting neither agent-facing file so much as mentions the
identifier. The honest substitute ships in its place — `fareNotes`, human prose the
passenger reads on their own booking, which is what the learned procedure has to
READ in order to choose a matching category.

The transferable question is therefore **"what does my `GET /ledger` answer
with?"**, not only "what did I write into a prompt". Any code-shaped value stored
on a published record is a channel, and it is the least visible one, because
nothing about it looks like an instruction to the model.

**The shipped shape.** A gate's code parameter is a free `z.string()` whose
`.describe()` states the withholding out loud ("You are NOT given the catalogue —
use the exact code the planner demonstrated, or ask them which code applies"), the
tool description says the same, and the prompt names escalation codes as the one
thing NOT in context. The labels stay exported for the HUMAN filing form; it is
the agent that must not see them, not the operator.

**BUILD THAT FORM — it is the sixth channel, and it is the one that must be OPEN.**
Withholding the vocabulary from the agent is only half the mechanism; the other
half is a surface where the operator picks a code and the agent watches them do
it. A skin that withholds perfectly and ships no form has an unlearnable gate.
Worked example: `src/skins/logistics/components/escalation-form.tsx`, rendered on
the Control Tower under "Authority escalations". Two properties of it are
load-bearing. The menu lists JUSTIFYING codes and DECOYS together, unmarked and
in catalogue order — a form that flagged the working ones turns the
demonstration into a guided tour, following an instruction the app gave rather
than exercising knowledge only the operator has. And the filing step logs the
code as DATA (`logStep(label, code)`) exactly as the operator entered it, decoy
included: a recorder that quietly corrected them would report a procedure nobody
demonstrated, and the release they then watch stay blocked is the demonstration
working, not failing.

**Why a lint rule and not a test.** Every symptom here is invisible: the app
compiles, type-checks, lints and demos with the readable restored. So the guard is
an AST `no-restricted-syntax` selector, `withheldGateVocabulary` in
`eslint.config.mjs`, beside the LOCK_SKIN ones and for the same reason — a failure
with no runtime symptom. It matches an `Identifier` named `*_CODES` /
`*_CODE_LABELS`, deliberately not source text: the schema leak was LINE-WRAPPED
(`.enum(ESCALATION_CODES)` sat on its own line), so a guard for the string
`"z.enum(ESCALATION_CODES)"` would have silently never matched.

🚨 **THE RULE COVERS TWO CHANNELS. Do not read a green lint as a withheld
vocabulary.** It matches an IDENTIFIER, so it catches the readable and the schema
enum — the two channels that name the catalogue in code. The tool `description`,
the agent prompt and a 422 body are **prose**, and no identifier selector can catch
a sentence. A domain-named field like `waiverGround` is not caught either, since it
matches neither `*_CODES` nor `*_CODE_LABELS`. All of those are a HAND-REVIEW item,
and they are not the minor half — the tool description and the prompt are the two
channels most likely to survive a first pass. The cheap check, run it
every time you touch a gate:

```bash
grep -nE 'ESCALATION_CODE|_CODES|catalogue|valid codes' \
  src/skins/<id>/tools.tsx src/skins/<id>/agent.ts
```

Then READ each hit: the only acceptable ones are sentences telling the agent it
does NOT have the catalogue.

⚠️ **Its `files` glob lists only the skins whose gate has landed. Append BOTH
agent-facing files of your skin — `tools.tsx` AND `agent.ts` — when yours does,
or your skin is unguarded.** The rule is scoped narrowly on purpose, because a
glob covering an unfixed skin turns the tree red for a whole phase. `agent.ts`
matters as much as `tools.tsx`: it is where the prompt leak lives, and where a
server-side `defineTool` can carry the same enum.

⚠️⚠️ **And when you widen that glob, RESTATE every selector the block's files
already resolve to.** Flat-config `rules` options are **replaced, not merged**, so a
block listing only `withheldGateVocabulary` silently disables the three URL-contract
selectors for exactly the files it names. The failure is silent: `pnpm lint` stays
green, and no test notices if the file it disabled them for has no nav shape to
violate. A passing `pnpm lint` proves nothing about a rule you have just switched
off.

**Do NOT verify this by COUNTING selectors.** A count rots the moment a block
changes — `actions.ts` resolves to two, a gated file's number moved again when
`statusKeyedTerminalRender` joined the same block. The mechanical check is the
resolved-selector table in
`src/shell/skins-config.test.ts` § "the resolved `no-restricted-syntax` selectors",
which asserts the resolved selector LIST **by name, per file**, through
`ESLint#calculateConfigForFile`. Add a row for every file whose selector set you
change. `npx eslint --print-config src/skins/<id>/tools.tsx` is the by-hand version
— read the names, do not tally them.

**And prove it over pure REST, with no agent in the loop.** Four assertions in
order: the gate refuses with a symptom and no code named; a DECOY code records and
approves and still does not unlock; an uncatalogued code is refused without
enumerating the catalogue; a JUSTIFYING code lifts the gate.
`docs/teach-mode/verify-logistics-gate.sh` (logistics) and
`verify-teachable-gate.sh` (banking) are the two worked examples. Discover the
case from the live API rather than hardcoding it — assert against logistics'
`absorb`, which always costs `$0` and can therefore never be over authority, and
the script "passes" a gate it never exercised. Two more
ways such a script passes vacuously: asserting the ABSENCE
of the fix in a refusal without also asserting the PRESENCE of the symptom (an
empty message satisfies "does not name a code"), and treating the unlocked call's
`200` as the proof — re-READ the record and assert the write actually landed.

**A gate can also be defeated without ever being addressed — by a SECOND control
that quietly authorizes past it. See § 12.**

---

## 11. If you are REVIEWING or FIXING a skin: fix classes, not instances

> **A class sweep always finds more instances than the finding that triggered
> it.** Across ten sweeps on `commerce`: a 2-secret finding was 5 secrets, a 4-site
> finding was 9 sites, a 5-site finding was 9 sites out of 33 consumers that had to
> be enumerated to find them, and a finding naming 4 write controls included two
> more in a file nobody had scoped.

Fixing the named line and moving on is what leaves ~233 findings in a tree that has
already had ~95 fixes applied to it. There is nothing special about that skin; the
shape is that a skin is written surface by surface, so a mistaken idea about how to
describe something gets applied everywhere that idea appears.

**The technique that made the sweeps work: require an ENUMERATION with negatives
recorded.** Not "I checked the rest" — that is unfalsifiable — but a list of every
consumer, call site, render or write path in the class, each with a verdict.
Concretely:

- 33 floor-fact consumers listed; 9 defects, 20 confirmed already honest.
- All 19 gen-UI renders walked field by field; 9 defects.
- 13 candidate echo paths listed; 3 needed redaction, 10 recorded as fine.

The negatives are what make the enumeration checkable, and they are the only thing
that catches a scoping error in the class itself — a file dropped while assembling
it. A prompt saying "fix these five sites" fixes five sites and tells you nothing
about the sixth.

Two corollaries:

- **A class sweep may legitimately span several commits.** Separate a pure move
  from a behaviour change (§ 8), and report every hash.
- **When you remove a pattern from the app, remove it from this skill in the same
  commit.** A doc edit scoped to the change that caused it auto-merges; a sweep
  deferred to "later" leaves the skill teaching the pattern you just deleted. That
  is CLAUDE.md's standing rule doing its job; see the top of this app's CLAUDE.md
  for why it is a rule rather than a nicety.

---

## 12. A second factor is not an authority override — beats 3a and 6 share a gate

Beat 3a wants a control the user types a secret into. Beat 6 wants a gate the
agent cannot clear until it has watched the operator clear it once. **In every
skin that has both, they touch the same write** — and the cheapest way to build
3a is to let the secret RELEASE the thing the gate is refusing. Do that and beat
6 is dead: the agent has a second door, it never has to learn the procedure, the
teach arc never fires, and **nothing fails**. The app compiles, the PIN card is
gorgeous, the write lands, the room applauds.

**The rule.** A second factor confirms **who is acting**. It never changes **how
much they may commit**. An escalation raises a limit; a PIN proves identity. That
is also how it works in the world, which is why the demo reads as real when you
get it right.

**What that forces on the card.** Offer only an option the operator is ALREADY
authorized to take, and when none is, say so instead of showing a box that cannot
succeed:

```tsx
const cap = currentPlanner.authorityUsd;
const option = computeMitigationOptions(shipment, lanes)
  .filter((o) => o.costUsd > 0 && (cap === null || o.costUsd <= cap))
  .sort((a, b) => a.costUsd - b.costUsd)[0];
if (!option) return <>…this one needs an escalation, not a PIN.</>;
```

Two traps inside those two lines, both of which bit this app:

- **`costUsd > 0` is load-bearing.** logistics' `absorb` always costs `$0`, so
  without it the card asks for a PIN to release nothing — a formality dressed as
  an authorization. (The same `$0` option made the beat-6 proof script vacuous;
  § 10.)
- **Do NOT give the tool a `kind`/amount parameter.** If the agent picks the
  option, the agent can pick an over-authority one, and you are back to asking the
  PIN to do the gate's job. The card picks; the agent only names the record.

**And enforce it SERVER-side, where the gate lives.** The card choosing well is a
convenience; the route refusing is the guarantee. The authorization route
recomputes the cost itself and runs the very same `checkAuthority()` the ordinary
write runs, so a hand-rolled `curl` with a valid PIN and an over-authority option
is refused exactly like any other over-authority write.

**Pin it with a test, because this failure has no other symptom.**

```ts
it("REFUSES a valid PIN on an over-authority option with the AUTHORITY error", …)
```

`src/app/api/logistics/v1/authorizations/route.test.ts` is the worked example
(discover the over-authority option from the live costs — do not hardcode one, or
a seed change turns the assertion vacuous). Verified by deleting the check: that
one test goes red and **every other test in the tree stays green**. A companion
assertion is worth having too — that a JUSTIFYING escalation still lifts the same
block — so the test says what the unlock path IS, not only what it is not.

**Finally, the prompt must not offer the card as a workaround.** The agent reads
"REJECTED: over your approval authority" and will try the other tool it has. Say
in `agent.ts`, out loud, that the PIN is a second factor and never a way past a
rejection.

---

## 13. Nothing in this app type-checks a test file unless you run `tsc` yourself

**`pnpm lint` · `pnpm test:unit` · `pnpm build` can all be green over a test file
that does not type-check.** Three gates, three greens, and the type error is still
sitting there.

Why each one misses it:

- **`next build`** type-checks only what the app's **module graph reaches**. A test
  file is imported by nothing the app renders, so Next never opens it. This is the
  part that misleads — there is no `typecheck` script in `package.json`, so "the
  build type-checks" is the natural conclusion.
- **Vitest** transpiles. It does not type-check, at all, ever.
- **ESLint** is not a type checker.
- **`tsconfig.json` DOES include `**/*.tsx`\*\* — so the tests were always *in\* the
  project. Nothing was looking.

```bash
pnpm exec tsc --noEmit   # the ONLY full type-check in this tree. Run it.
```

**Why this belongs in a file about lies rather than a file about commands.** A
green gate is a CLAIM, and this one is a false claim of exactly the shape
everything else here is about: it renders as success. Worse, it silently voids a
whole class of guard this skill tells you to write. Several of the strongest
assertions in the tree are **type-only** — the exhaustiveness gate over
`AttachmentFailureCause` (demo-beats.md § 3d), a fixture typed against the real DTO
so a field rename fails the test rather than the demo, `satisfies` on a lever
vocabulary. Every one of those is _decoration_ until `tsc` runs. § 7's rule applies
one level up: for every GATE, ask what would have to break for it to go red.

Add it to your verification list beside lint and tests (SKILL.md § Verification
step 1 now names all four, cheapest first), and run it after any change to a type
surface a test asserts against — which is most of them.

---

## 14. A lookup keyed by URL input must be a `Map`, or the 404 branch never fires

`resolvePage` receives the URL segments after `/<skin>` — **untrusted caller
input** — and the obvious scaffold for it is a table plus a `?? null`:

```ts
const PAGES: Record<string, ComponentType> = { "": Home, reports: Reports };
resolvePage: (segments) => PAGES[segments.join("/")] ?? null; // 🚨 BROKEN
```

An object literal inherits `Object.prototype`, so `PAGES["constructor"]` is a
truthy `Function`. `?? null` never fires, the shell's `if (!Page) notFound()` is
bypassed, and `/<skin>/constructor` hands React a `Function` where a
`ComponentType` was declared: **a 500 where a 404 belongs.** Same for
`"toString"`, `"valueOf"`, `"hasOwnProperty"`, `"__proto__"`, …

**`Record<string, ComponentType>` cannot catch this. The annotation is a lie about
a plain object** — it describes the own keys and says nothing about the chain,
which is exactly why the bug reads as correct in review.

The fix makes the bad state unrepresentable rather than adding a guard per call
site:

```ts
const PAGES: Map<string, ComponentType> = new Map([
  ["", Home],
  ["reports", Reports],
]);
resolvePage: (segments) =>
  PAGES.get(segments.length === 0 ? "" : segments.join("/")) ?? null;
```

`Map.get` only ever sees own entries. templates.md's scaffolds are already written
this way, and `src/shell/resolve-page-prototype.test.ts` pins it for every
registered skin, so a new skin that copies the template is covered without adding
a test.

**Then sweep the class, per § 11 — this is not one call site.** Any lookup whose
KEY comes from outside your code has the same defect, and the other one in this
app is worse: the operator→identity map inside
`intelligence/user-id.ts` is keyed by `properties.userId`, forwarded by the
CLIENT. With a plain object, `operatorId && IDENTITY[operatorId]` resolves truthy
for `"toString"`, and `.userId` on the inherited member is `undefined` — so
`identifyUser` hands Intelligence an `undefined` memory bucket. No error. Writes
and recall both go somewhere nobody intended, and beats 4/5/6 are precisely the
beats that depend on that scope being right. `src/skins/commerce/intelligence/user-id.ts`

- its `user-id.test.ts` are the worked pair; templates.md carries the same warning
  inline.
