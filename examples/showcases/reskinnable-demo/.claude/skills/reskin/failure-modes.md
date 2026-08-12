# Failure modes — how a skin lies

Read this before you write tools or pages. It is not a bug list; the per-file
traps live in [templates.md](./templates.md) and this file cross-links to them.
It is the set of ideas you need up front, because each one changes a decision you
make while writing, and none of them belongs to a single file.

Everything here came out of one review of the `commerce` skin: two rounds, one of
them twenty-four independent agents, ~233 findings that resolved into about a
dozen recurring classes. The classes are what generalise; the individual bugs do
not.

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

⚠ **The reach of this fix is the whole lesson.** The first pass at it introduced
the tri-state and updated **16 consumer sites**. Nine more instances survived,
including a card sort order, a missing on-screen caveat, a book-scope confusion and
a third private rank table — found only by enumerating all **33** floor-fact
consumers and recording a verdict for each. Twenty of the 33 were already honest,
which is the evidence that the vocabulary was right and only its **reach** was
short. If you introduce a tri-state, grep for every consumer of the old boolean and
write the list down. See § 10.

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
  a choice the agent has not made. A Sort chip printed "Sort · oldest first" over
  an unset lever; a lookup card flashed a red "nothing matches ''" before its
  needle arrived; a beat-4 "why" band drew as an empty coloured bar while its note
  streamed. Every one of those renders, in the house style, and then **flips** when
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

⚠ The finding that opened this class named **4** sites. Walking all **19** renders
field by field found **9**, including two failure modes nobody had reported and
three confident receipt LINES — `goes live at % off`, `Waiver id undefined`, and
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

That fourth case is the one that keeps shipping — it turned up in **three separate
files** in this skin, each time only because the sweep was asked to look for it
rather than assume. Treating a landed write as a failure re-arms the control and
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
do not own, and **an unobserved step is an assumption**. Six independent ways it
reported success having achieved nothing — and the whole point of the beat is the
claim "it read a real document", so a silent failure makes the model INVENT the
document's contents, your tool file the artifact anyway, and the beat prove the
exact opposite of what it says while reading perfectly.

Three rules, in order of how often they are skipped:

- **Reporting a failure is the easy half; DETECTING it is the half that gets
  skipped.** Hardening the error path while every failure still resolves `true` is
  the version of this that ships.
- **A fixed sleep is not a confirmation.** It races an async encode. The original
  code waited 500 ms and returned success; the red proof against it was seventeen
  failures "at 564 ms each — the old sleep completing and claiming success". Wait
  on a **CONDITION with a bounded budget**, and treat an expired budget as a
  failure, not a green light.
- **Read the framework's source for the observable signals**, and be specific:
  file accepted vs silently rejected (`processFiles` drops anything failing
  `accept`/`maxSize` and calls an `onUploadFailed` nobody wires), encoding
  finished, send button in SEND vs STOP vs disabled (one button plays both roles,
  so mid-run a click CANCELS the run), and the click itself confirmable.

⚠ **If no signal exists for one of them, fail CLOSED and say so in a comment.**
This is the part to copy. Commerce's `stagePriceSheetAttachment`
(`src/skins/commerce/attach-price-sheet.ts`) established from source that no
`ready` status attribute exists AT ALL, so it uses a filename-in-queue proxy,
documents that it is a proxy, and makes the bounded wait around it fail closed —
rather than quietly assuming success on the one step it could not observe.
Everything else it does verify: `%PDF` magic bytes rather than a 2xx, acceptance
by a chip appearing in the queue, and the send by the attachment LEAVING the
queue. It classifies fifteen distinct causes, because "a presenter needs to know
whether to retry, press send by hand, or restart the dev server". The full
failure table is in demo-beats.md § 3d.

⚠ `banking/attach-invoice.ts` and `people/attach-offer-letter.ts` predate this and
carry the identical unfixed defect. Copy `commerce` for this beat, not banking.

---

## 5. Redact from an env-derived secret SET, not from one argument

Anything presenter-facing that echoes backend text — a `dev/reset` response body,
an error surfaced in an alert, a `memoryError` sentence — has to be scrubbed
against **every** secret the environment holds, derived from the environment
itself.

A redactor that takes one secret as an argument is a redactor that will miss the
next one. This one scrubbed the backend URL faithfully and **leaked the API key
verbatim five times in a single response body** — a presenter-facing body, on a
control a presenter clicks. The finding named two secrets; the sweep found five.

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

⚠ Also: route every NEW echo path through it. The same sweep noted that fixing an
unrelated `failed[].reason` field would reintroduce the class through a new path.
And `banking` and `people` have this class today, worse (an unredacted
`memoryError` plus an echoed `apiUrl`) — do not copy their reset routes.

---

## 6. A guard you never tried to fool is not a guard

Two rules, and the second is the sharper one.

**Validate a check against content it must NOT flag, not only content it must.**
"Zero false positives on today's tree" proves that no CURRENT sentence trips your
rule — not that no LEGITIMATE sentence does. The doc drift guard shipped in this
very loop passed exactly that bar and then fired on a truthful sentence ("the
sixth skin", a real reference) and on a deliberate partial glob. The tree simply
did not happen to contain the shapes that break it. The fix pinned **must-flag AND
must-not-flag fixtures** for each discriminator, so neither can be quietly widened
back — read the header of `src/shell/skin-roster-docs.test.ts`, which documents
both false positives and why the weaker validation missed them.

**And when a check PASSES, ask where its premise came from.** If the premise came
out of the artifact under test, the check agrees with the bug. Three instances in
one review:

- A WCAG contrast assertion measuring the wrong background — the chip renders on a
  12% tint, the guard measured the card. The card said 4.52:1 (pass); the real
  ground said 3.75:1 (fail). Worse, the app's own `design-skill.ts` carried the
  same false justification, so it was instructing GENERATED UIs to use a colour
  that fails AA. The fix changed **the colour, not the assertion** — the lazy fix
  here is always to move the goalposts. See `src/skins/commerce/theme.test.ts`,
  whose pairs now composite an alpha ground before measuring and DERIVE their
  render sites from grep patterns that fail when a pattern finds nothing.
- PDF `/Length` and xref byte offsets asserted in **decoded characters**, so the
  multi-byte desync the file exists to catch can never fail them. Two reviewers
  disagreed here — one said the mechanism was broken, the other that the outcome
  was fine because the document is ASCII — and this note used to record the
  dispute as unresolved. **It is resolved, and both were partly right.** The
  assertions really do pass for a reason other than the one they name; they also
  really cannot fail today, because `toAscii` makes characters and bytes the same
  thing. The gap neither reviewer named is that **`toAscii` was the load-bearing
  premise and nothing asserted it** — relax the fold and the assertions go on
  passing while the PDF breaks. It is now pinned by `price-sheet-pdf.layout.test.ts`
  § "ASCII invariant", which builds from accented input and asserts every emitted
  byte is `< 0x80`.

  What that taught, and the reason it is worth more than the open question: an
  argument about whether a passing check is "really" wrong is usually the wrong
  argument. **Find the premise the pass depends on and assert THAT.** It ends the
  dispute without either side having to concede, and it is the only version that
  still holds a year later.

- `npx prettier --check` reporting "All matched files use Prettier code style!" on
  `templates.md` while two of its `.theme-<id>` placeholders read `.theme-<id >` —
  prettier's CSS parser re-spaces `<id>` inside a fenced `css` block, so **prettier
  considered its own mangled output canonical**. The fix is the
  `<!-- prettier-ignore -->` guard now in templates.md. Do not remove it, and guard
  any new fenced CSS block with placeholders the same way.

---

## 7. Test traps that produce green for the wrong reason

This review found roughly twenty-two tests that passed while the behaviour they
name was wrong or never exercised. That number matters because a large green suite
was what every earlier gate relied on for confidence — the gate was weaker than
the record said it was.

**The general rule: for every assertion, ask what would have to break for this to
go red. If you cannot answer, the test is decoration.** The concrete, transferable
traps:

- **Vitest `it.each` SPREADS array rows.** An `[]` case therefore runs with NO
  argument — the title prints a literal `%o` — and silently duplicates the
  `undefined` case. The coercion the docstring specifically called out was never
  tested.
- **`expect(...).toBeTruthy()` passes for `[]`**, which is very often the exact
  failure being guarded (here: the blank generated panel).
- **Mocking a `Promise<boolean>` contract as `Promise<void>`** resolves
  `undefined`, which is falsy — so the HAPPY path silently exercises the failure
  branch. `vi.mock` does not type-check its factory against the real module. This
  is the natural companion to § 3: the moment `refresh()` became
  `Promise<boolean>`, every `async () => {}` mock of it started asserting the
  stale-view branch while looking green.
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
- **A test that pins the wrong behaviour.** Several here bless a truncation the
  route refuses, or a caption whose grammar is wrong. When a fix requires changing
  a test, check whether the test was the bug.

⚠ Honest status: most of these are **parked, not fixed** — they change no shipped
behaviour, so they lost to the merge gate. Several are still live in commerce's
test files. Treat this section as a list of shapes to avoid, not as a description
of an exemplary suite.

---

## 8. Put a shared helper where a second page can import it

`useInFlight` already existed and was already correct — ref mutex, `finally`,
honest `false`. It just lived **inside a page module**. The second page that
needed it grew a weaker local copy with no mutex and no `finally` instead, whose
rejecting fetch wedged a button until the presenter reloaded.

A hook exported from `pages/promotions.tsx` does not READ as importable. That is
the whole bug. It now lives in `src/skins/commerce/components/use-in-flight.ts`,
and its header says why in one line worth stealing: "One definition, every
caller."

Two transferable habits:

- Anything two surfaces will plausibly need goes in `components/` (or `data/`, or
  a bare module at the skin root) from the start — not in whichever page needed it
  first. This review found **six** hand-copied-helper defects, most of them with
  the same origin.
- ⚠ **When you find two divergent copies of a helper, check where the ORIGINAL
  lives before assuming the copier was careless.** The copy is usually a symptom of
  placement, and fixing the copy without moving the original just sets up the third
  copy. Do the move as its OWN commit, separate from the behaviour change — a
  semantic change hidden inside a relocation is unreviewable.

---

## 9. State a claim as an invariant plus the command that proves it

Sixteen documentation findings in this review were **all one shape**: prose
hard-coded a count or a roster, the set grew, and nothing checked it. "ships four
of them", "these four", a four-value `LOCK_SKIN` list, "all four stay reachable",
"the unlocked four-skin demo". Every one was true when written.

Prose discipline had already been tried here — CLAUDE.md's standing rule to
re-read this skill after every change predates those sixteen instances and did not
prevent them. So the durable fix is not "be careful", it is **to replace the fact
with its derivation**:

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

## 10. If you are REVIEWING or FIXING a skin: fix classes, not instances

The strongest single number this build produced:

> **Ten class sweeps ran. Every one found more instances than the finding that
> triggered it.** A 2-secret finding was 5 secrets. A 4-site finding was 9 sites.
> A 5-site finding was 9 sites, out of 33 consumers that had to be enumerated to
> find them. A finding that named 4 write controls turned out to include two more
> in a file nobody had scoped.

Fixing the named line and moving on is what produced ~233 second-round findings
from a tree that had already had ~95 fixes applied to it. There is nothing special
about this skin; the shape is that a skin is written surface by surface, so a
mistaken idea about how to describe something gets applied everywhere that idea
appears.

**The technique that made the sweeps work: require an ENUMERATION with negatives
recorded.** Not "I checked the rest" — that is unfalsifiable — but a list of every
consumer, call site, render or write path in the class, each with a verdict.
Concretely:

- 33 floor-fact consumers listed; 9 defects, 20 confirmed already honest.
- All 19 gen-UI renders walked field by field; 9 defects.
- 13 candidate echo paths listed; 3 needed redaction, 10 recorded as fine.

The negatives are what make the enumeration checkable, and they are what caught a
scoping error the orchestrator had made — one file's write controls were dropped
while assembling the class, and the sweep's own required whole-skin enumeration
surfaced it. A prompt saying "fix these five sites" fixes five sites and tells you
nothing about the sixth.

Two corollaries:

- **A class sweep may legitimately span several commits.** Separate a pure move
  from a behaviour change (§ 8), and report every hash.
- **When you remove a pattern from the app, remove it from this skill in the same
  commit.** Four independent sweeps each found the skill still teaching the pattern
  they had just deleted, and all four doc edits auto-merged precisely because each
  was scoped to the change that caused it. That is CLAUDE.md's standing rule doing
  its job; see the top of this app's CLAUDE.md for why it is a rule rather than a
  nicety.
