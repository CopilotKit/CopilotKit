# Keel — Harbor Point Health: the demo beat map

> Authored BEFORE the REST substrate was written, per
> `.claude/skills/reskin/demo-beats.md` § "The beat map (fill this in BEFORE
> writing code)". This file is the contract the later slots build against: the
> tools, the pages, the prompt and the pills all come out of it.
>
> Keel today is `useKeelData`, an in-memory `useState` store, and it hits about
> one beat. This map is what the skin becomes once the substrate under it is a
> real ledger.

## What Keel is, restated so the beats have somewhere to land

Keel is Harbor Point Health's **knowledge and operations desk**. It already had
two halves: a **policy corpus** (`knowledge/corpus.ts` — nine documents across
three spaces, full prose, cited by section) and a **run engine** (playbooks,
runs, approval gates, personas).

The substrate adds the half that was missing and that every beat needs: the
**policy register** — the LIFECYCLE state of each of those nine documents.
Corpus supplies the words; the register supplies review dates, attestation
coverage, the effective revision, and the revision currently waiting to be
released. That split is deliberate and load-bearing:

- The corpus is prose that only ever changes when an author edits it. It stays a
  static, server-safe module.
- The register is operational state that the demo MUTATES. It lives in the REST
  store.
- `knowledge/<docId>` joins the two — `GET /api/keel/v1/documents/<docId>`
  returns `{ doc, record }`. That is how the parameterized route survives.

Everything a hospital document-control office actually does — reviewing,
endorsing, releasing, attesting, chasing owners — is now a write path.

⚠️ **Scope discipline for the whole skin.** This is a document and operations
GOVERNANCE desk. No beat here decides anything clinical. The gate is about who
may RELEASE a policy revision to the workforce, not about what the policy says.

---

## The map

| Beat              | This skin's step                                                                        | Pill                                | Implemented by                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1 face            | Policy-library health: attestation coverage + review-debt tiles and a per-space chart   | "How healthy is the library?"       | `useComponent` chart over `GET /ledger` → `deriveRegisterKpis` / `summarizeRegister`                  |
| 2 rich thread     | The beat-1 chart, the citation chips and the release receipt all replay from `result`   | (none — demonstrated by reload)     | every keel gen-UI keyed off the tool `result`, never `status`                                         |
| 3a drive the app  | Release a **fully endorsed** revision by typing an **e-signature PIN** into the chat    | "Release the STD-045 revision"      | HITL `countersignRelease` → `POST /countersignatures`; PIN never enters the transcript                |
| 3b sees my screen | "What's on my screen?" on the Register, then again on `knowledge/<docId>`               | "What am I looking at?"             | route readable in `layout.tsx` + per-page on-screen readables (register rows, open document sections) |
| 3c levers         | Four levers on the Register: space × attention × sort × top-N, all four tinted          | "Show me what's overdue for review" | HITL `showRegister` → `?space=&attention=&sort=&top=` → `data/register-levers.ts`                     |
| 3d multimodal     | A regulatory bulletin PDF is attached; the agent files a durable **Impact Brief**       | "Read this bulletin"                | `@/shell/attach` wrapper + `fileImpactBrief` → `POST /briefs`; brief listed on the Register page      |
| 4 memory          | "Summarize the library" obeys the seeded reading preference and SAYS it did             | "Summarize the library"             | seeded topical memory → `recall_memory` → `showRegisterSummary(note)`                                 |
| 5 stored skill    | "POL-121 is out of date — handle it" fires three ordered writes on the record           | "POL-121 is out of date, handle it" | seeded operational memory → `raiseReviewFlag` + `sendOwnerNotice` + `addDocumentNote`                 |
| 6 teach a skill   | Releasing an **unendorsed** revision is refused; the operator teaches the variance path | "Release the POL-114 revision"      | `POST /documents/:id/release` → `403 UNENDORSED_REVISION`; unlock via `POST /variances` + `/ratify`   |
| (reset)           | Presenter reset restores the register, the runs and the artifacts                       | (button, not a pill)                | `POST /api/keel/v1/dev/reset`                                                                         |

Pill count target: **eight** (one per beat, skipping beat 2). Keel's existing
four pills — policy question, start a run, what needs me, canvas report — are
the skin's identity and must survive; the pills above are the beat-carrying
additions, and reconciling the two into a final eight-to-nine list is the
suggestions slot's job. The canvas report already has its own ask
("Where are we stuck?"), which is the ninth-pill exception `people` and
`commerce` also take.

---

## Beat 3a — the secret the UI holds and the agent never sees

**The Harbor Point equivalent of logistics' planner PIN is an e-signature PIN.**
Releasing a policy revision to the workforce is a signed act: the register
records WHO put that text in front of every employee. Clinical systems already
work this way (e-prescribing, chart co-signature), so the room recognises it
instantly and nobody has to be told what the box is for.

- The agent calls `countersignRelease({ document })` — **the record only**.
- A card in the chat asks the operator for their six-digit e-signature PIN.
- The card POSTs `{ document, pin, personaId }` to
  `POST /api/keel/v1/countersignatures`. The agent's `respond()` gets one
  sentence: `"Rev B of STD-045 is released."`
- No response body ever echoes the PIN. A refusal says "that PIN was not
  accepted", never what was typed.

⚠️ **The PIN is a second factor, NEVER an authority override**
(failure-modes.md § 12). The countersign route re-runs the SAME
`checkReleaseAuthority()` the ordinary release route runs, so a valid PIN on an
**unendorsed** revision is refused with the identical `UNENDORSED_REVISION`. If
the PIN could release an unendorsed revision it would be a second door around
beat 6 — the agent would take it, the teach arc would never fire, and nothing
would fail. `countersignatures/route.test.ts` pins that separation; it is the
only symptom the failure has.

Which is why the seed carries **STD-045 Rev B, fully endorsed and awaiting
release**: beat 3a's card must offer an act the operator is ALREADY authorized
to take. The card picks the record's own pending revision; the agent never gets
to choose which revision or to name an endorsement.

**Honesty note carried into the code:** PIN validity is FORMAT-ONLY. No persona
holds a PIN or a digest, so any six digits are accepted. That is deliberate for a
stage demo — a memorised number is a thing to fumble in front of a room — and the
beat's claim is about WHERE the value travels, not about authenticating anyone.
Stated out loud in `data/signing-pin.ts` so nobody mistakes it for an auth
control.

---

## Beat 4 — the topical preference

The persona is a knowledge/ops lead who reads the register the same way every
week. The seeded memory (a later slot writes the file; this is its content):

> When Sam asks for a summary of the policy library, group it by knowledge space
> — Privacy, Clinical, Vendor — and lead each group with anything past its
> review date. Give attestation coverage as a whole percent, never a fraction,
> and name the owning department beside every document ref. Say when a
> document's attestation coverage is not measurable rather than printing 0%.

Four things a reader can VERIFY happened, which is what makes the beat visible:
grouping, overdue-first ordering, whole-percent coverage, owner beside the ref.
The last clause is the honesty clause and it is real: a document with nobody
assigned has **unknown** coverage, not 0% (failure-modes.md § 1), and
`data/attention.ts` models that as a tri-state so obeying the preference and
telling the truth are the same code path.

The summary component carries a `note` slot where the agent names the preference
it applied — without it the room sees a normal answer and the beat is invisible.

---

## Beat 5 — the stored procedure

**One vague sentence:** _"POL-121 is out of date — handle it."_

The seeded operational procedure, in order, all three writes on the ONE document
record (so `GET /documents/:id` already returns them and the register row and the
document page paint them with no new read path):

1. **Raise a review flag** on the document — `POST /documents/:id/flag` with a
   reason from a CLOSED set the agent IS given: `REVIEW_OVERDUE`,
   `REGULATORY_CHANGE`, `INCIDENT_FOLLOWUP`, `CONTENT_CONFLICT`.
2. **Send the owning department a notice** — `POST /documents/:id/notices` with a
   template from `REVIEW_DUE`, `EVIDENCE_REQUEST`, `ATTESTATION_PUSH`,
   `RETIREMENT_NOTICE`.
3. **Post a note on the record** — `POST /documents/:id/notes`. The store
   FORCES a 🚨 marker onto the text (`markNote`), because the whole point is that
   the room can see the record changed from the back of the room and a model that
   phrases it politely would silently cost the beat its only visible artifact.

⚠️ The vocabularies in steps 1 and 2 are **closed AND given to the agent** — the
exact opposite of the variance catalogue in beat 6. A value outside them is a
model error worth surfacing, so those refusals DO name the valid set. Said out
loud in `data/handling.ts`, because the two closed sets sitting one directory
apart is exactly how a future edit leaks the wrong one.

Distractors around it: `search_knowledge`, `showSources`, `openDocument`,
`showPlaybook`, `startRun`, `showApprovals`, `showRegister`, `navigateTo`,
`render_ops_report`. "It picked the right three" therefore means something.

The prompt must say plainly that this is a DIFFERENT procedure from beat 6's
release path and that it must not offer to record anything.

---

## Beat 6 — the teachable gate (the most important design decision)

### The refusal

`POST /api/keel/v1/documents/<docId>/release`

A pending revision may only go to the workforce once **every body on its
required-endorsement list has endorsed it**. When one has not:

```
403 UNENDORSED_REVISION
"Rev D of POL-114 has not been endorsed by the Policy Governance Committee.
 It cannot be released to the workforce."
```

**Symptom only.** It names the document, the revision and the body that has not
signed. It never mentions a variance, a code, a catalogue, or any way through.
An operator who already knows the procedure reads that and knows what to file;
an agent that does not, does not — which is the whole beat.

### The unlock path

A **publication variance**: a time-bound, coded record that lets an unendorsed
revision go out ahead of its committee.

```
POST /api/keel/v1/variances            { docId, code, rationale } -> 201 draft
POST /api/keel/v1/variances/<id>/ratify                           -> ratified
```

Ratifying links the variance to the document's pending revision
(`activeVarianceId`). The release gate then allows the release **only if the
variance's code is justifying**.

### The catalogue — WITHHELD FROM THE AGENT

Six codes, in `data/variance-codes.ts`, whose header states the withholding in as
many words (mirroring `logistics/data/escalation-codes.ts`).

**Justifying (4) — these actually lift the gate:**

| Code                    | Label                                                      |
| ----------------------- | ---------------------------------------------------------- |
| `PATIENT_SAFETY_ALERT`  | Active safety alert requires the revised text in effect    |
| `ACCREDITATION_FINDING` | Survey finding requires immediate correction               |
| `REGULATORY_MANDATE`    | Statutory or payer requirement with a fixed effective date |
| `INCIDENT_CONTAINMENT`  | Open privacy or security incident depends on this text     |

**Decoys (2) — filed honestly, recorded in the register, unlock NOTHING:**

| Code                 | Label                                                |
| -------------------- | ---------------------------------------------------- |
| `COMMITTEE_CALENDAR` | Governing committee does not meet until next quarter |
| `EDITORIAL_CLEANUP`  | Typographical and formatting corrections only        |

`COMMITTEE_CALENDAR` is the load-bearing decoy: it is the reason a real person
would reach for an interim release, it sounds exactly like a justification, and
it is the one a bluffing agent picks. Watching a ratified `COMMITTEE_CALENDAR`
variance leave the release STILL blocked is the demonstration working, not
failing.

**Anything else** — `URGENT`, `CEO_APPROVED`, whatever the model invents — is
refused `422 UNKNOWN_VARIANCE_CODE` **without enumerating the valid set**.

### The two seeded gated cases

Two different documents carry an unendorsed pending revision, so the case taught
on stage and the case replayed unaided are different records:

| Document                                                                 | Pending revision | Missing endorsement         | Used for           |
| ------------------------------------------------------------------------ | ---------------- | --------------------------- | ------------------ |
| `phi-access-policy` — POL-114, PHI Access & Minimum Necessary            | Rev D            | Policy Governance Committee | the on-stage teach |
| `adverse-event-reporting` — POL-208, Adverse Event & Near-Miss Reporting | Rev C            | Policy Governance Committee | the unaided replay |

A third, `third-party-risk` — STD-045 Rev B — is **fully endorsed**, and is beat
3a's countersign target (see above). Three pending revisions, two gated, one
clear.

### The five leak channels

The vocabulary must not reach the agent through ANY of: a `useAgentContext`
readable, a `z.enum` on the filing tool's schema, the tool's `description`, the
prompt, or the 422 body. This slot closes the two it owns — the codes module
carries the warning header, and no route body enumerates the catalogue. The tools
slot must take a free `z.string()` on the code parameter, state the withholding
in its `.describe()`, and append `src/skins/keel/{tools.tsx,agent.ts}` to
`withheldGateVocabulary` in `eslint.config.mjs` **restating the LOCK_SKIN
selectors in the same block**.

**The sixth channel must be OPEN.** A human-facing variance filing form on the
Register page, listing justifying codes and decoys together, unmarked, in
catalogue order — the surface the operator uses while the agent watches. Without
it the gate is unlearnable. `VARIANCE_CODE_LABELS` is exported for exactly that
form and for nothing else.

---

## Beat 3c — the four levers

All four on the Register view, all four with an explicit "not pulled" value
INSIDE the enum so the model can SAY it did not pull one
(demo-beats.md § 3c — an `.optional()` lever gets filled anyway):

| Lever       | Values                                                       | Sentinel |
| ----------- | ------------------------------------------------------------ | -------- |
| `space`     | `privacy`, `clinical`, `vendor`                              | `all`    |
| `attention` | `review_overdue`, `attestation_short`, `unendorsed_revision` | `all`    |
| `sort`      | `review_due_asc`, `coverage_asc`, `reviewed_desc`, `ref_asc` | `all`    |
| `top`       | any positive integer                                         | `0`      |

One module owns the vocabulary, the chips, the query string and the tool's enums:
`data/register-levers.ts`. The page's controls, the confirm card's chips and the
schema all read it, so a lever the view will not honour is not expressible.

`status` (`draft` / `in_review` / `published`) is a rendered COLUMN, not a lever,
and that is a seed-driven decision rather than a stylistic one: only one of the
nine documents is plausibly a draft, so a `status` lever would ship a value that
leaves a single row on stage. `space` is 3/3/3 across the corpus, so every value
of every lever leaves several rows — `review_overdue` leaves three,
`attestation_short` three, `unendorsed_revision` two (the two beat-6 cases,
which is exactly the worklist that lever exists to reach), and no single-lever
pull empties the board.

Attention classes are NOT exclusive: POL-114 carries all three at once. The
filter asks "does this row carry this class", which is both the honest reading
and what keeps the counts above from having to be disjoint.

---

## Beat 1 — the face

`GET /ledger` → `deriveRegisterKpis` gives four tiles (documents in force,
past review date, attestation coverage, revisions awaiting release) and
`summarizeRegister` gives per-space groups the chart draws. Live figures, one
`useMemo`, mapped twice — once for the chart, once for the readable, so the two
can never disagree.

---

## Beat 3d — multimodal in, durable artifact out

**In:** a **regulatory bulletin** PDF, generated per request from the live
register, parameterized by knowledge space
(`GET /api/keel/v1/bulletin?space=privacy`). It cites policy refs the register
carries — plus exactly ONE ref it does not, appropriate to the space requested,
which is the row that proves the file was read rather than politely
acknowledged. That invented row is keyed per space and re-checked against the
live register before it is emitted, so a reseed drops it rather than
misattributing it.

**Out:** an **Impact Brief** — `POST /api/keel/v1/briefs` — a durable record on
the Register page. Delete the whole thread and it is still there.

**Field ownership, per demo-beats.md's `oldRateUsdPerKg` lesson:**

- `requiredAction` and the cited `ref` come from the DOCUMENT. Only a reader of
  the attachment knows them, and that is the beat's proof — model-authored.
- `currentRevision` is a REGISTER fact. The route SETTLES it: overwritten from
  the register on a unique ref match, DROPPED when the register carries no such
  ref (absence of the row IS the answer), never `??`-merged. The response returns
  both `settled` and `unmatched` lists so the tool can tell the agent rather than
  silently overruling it.

---

## Presenter reset

`POST /api/keel/v1/dev/reset`, gated by `presenterResetEnabled()` or a
non-production `NODE_ENV`. Restores the register (every pending revision
unreleased, every review flag / owner notice / 🚨 note gone, variances empty,
impact briefs empty) and the runs.

⚠️ **The memory half is NOT in this slot.** Keel has no
`intelligence/seed-memories.ts` or `forget-memories.ts` yet, so this reset
restores the DATA STORE ONLY and cannot re-arm beats 4, 5 or 6's memory state.
That is a silent trap — the button looks identical either way — so the memory
slot must add both files and extend this route. The route is written store-first
so that extension is additive.

---

## Where the health-ops domain fought the beats

Recorded plainly rather than papered over.

1. **Beat 3a wanted to be about a run approval, and must not be.** Keel's most
   natural "sign here" moment is approving a gate on a live run. But run
   approvals are already role-gated by `approverRole`, so a PIN there would be a
   second door around a DIFFERENT gate and would read as an authority override.
   Moving the PIN onto the release of an ALREADY-ENDORSED revision keeps it a
   pure identity confirmation. The cost is that beat 3a and beat 6 now touch the
   same write, which is precisely the collision failure-modes.md § 12 warns
   about — so the countersign route re-runs the release gate, and a test pins it.

2. **The run engine and the register are two substrates in one skin.** Runs tick
   on a 900 ms client interval (`useKeelData`); the register does not tick at
   all. The REST store therefore holds runs as STATE ONLY — the server does not
   advance them on a timer, and whichever slot migrates `useKeelData` has to
   decide where the ticker lives. Nothing in this map depends on the answer, but
   it is a real open question and is the biggest single risk in the migration.

3. **"Attestation coverage" is the one figure that can be genuinely unknown**,
   and a hospital register really does contain documents nobody has been assigned
   yet. Modelling it as a boolean would have published `false`/`0%` for "we did
   not look", so it is a tri-state everywhere it appears — which is more code
   than the beat strictly needs and is worth it.

4. **Nine documents is on the thin side for a four-lever board.** The corpus is
   not this slot's to extend, so the register's statuses and dates are arranged
   to keep every lever value non-empty. If a later slot wants a genuinely
   comfortable board, the honest fix is more corpus documents, not more register
   states on the same nine.
