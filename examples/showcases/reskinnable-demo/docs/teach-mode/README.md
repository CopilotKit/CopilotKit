# teach-mode — the teachable-gate loop, worked on the banking skin

> Scope: teach-mode is a **per-skin feature, not a shell feature**. This file
> documents it demo-agnostically as a 5-role contract and uses the **`banking`
> skin** (`src/skins/banking/`) as the worked example throughout; the app is a
> reskinnable shell that hosts one skin per `/[skin]` route, see the top-level
> `CLAUDE.md`.
>
> **Which skins implement it is deliberately not listed here.** A roster written
> into prose is the defect this repo keeps shipping — it goes stale the moment a
> skin lands, and nothing catches it (`src/shell/skin-roster-docs.test.ts` exists
> because that happened sixteen times in one review). The invariant instead: **a
> skin implements teach mode exactly when its `Tools` registers the recording
> hand-off**, so the roster is a command, not a sentence:
>
> ```bash
> grep -l offerWorkflowRecording src/skins/*/tools.tsx
> ```
>
> **The grep gives you the roster; it does not certify compliance.** Do not read
> it as "every skin it names follows all five roles" — an earlier revision of this
> paragraph said exactly that on the strength of two skins, and the third
> falsifies it. Verified role by role at the time of writing: **`banking`,
> `commerce` and `logistics` satisfy all five. `people` satisfies #1, #2, #4 and
> #5, and of role #3's TWO replay invariants it satisfies one and violates the
> other** — read both before deciding what to copy from it:
>
> - _Survives replay_ — **satisfied.** `people`'s `awaitDemonstration` render
>   (`src/skins/people/tools.tsx:1103`) counts `\d+\.\s` in `result`, and `result`
>   is the **tool result** — the observed-steps directive that `DemonstrationCard`
>   builds and hands to `respond?.()` (`tools.tsx:1337-1341`), numbering included.
>   It is not parsing its own rendering, and that branch prints no list that could
>   disagree with the number. The directive is what replays, so the count is
>   stable. It is still the brittle FORM — it parses a count instead of reading one
>   the recorder reported, so a numeral inside a step label would inflate it — but
>   that is a robustness gap, not a replay defect.
> - _A settle is not an answer_ — **violated.** `saveLearnedProcedure`'s render
>   (`tools.tsx:1135-1139`) prints "Saved. I'll use this next time" on ANY string
>   result, and the _Don't save_ button settles with one (`tools.tsx:1164-1167`).
>   The card asserts a durable write that never happened — live, and identically on
>   every replay, which is why it survived.
>
> **So copy `commerce` or `logistics`.** They are the two whose replay behaviour
> is _pinned_: `src/skins/commerce/teach-mode-directives.ts` and
> `src/skins/logistics/teach-mode-directives.ts` lift the two rules out of the
> render (`readDemonstratedStepCount`, `classifySaveProcedureResult`) so a
> round-trip test can hold the builder and the reader together. `banking` is
> correct but hand-rolled and unasserted, so it can rot without failing anything.
> The two pinned files are deliberate SIBLINGS rather than one shared module: a
> skin's only inbound dependency on shared code is the `Skin` contract, and the
> directives are domain wording, not shell machinery.
> **Neither grep below is a verdict** — a hit is a place to read, not a defect,
> and an empty result is not compliance:
>
> ```bash
> # SMELL, not a violation: a teach card deriving a count by PARSING a directive
> # instead of reading a count the recorder reported. This is people's hit — and
> # it is NOT people's defect.
> grep -n 'result\.match' src/skins/*/tools.tsx
>
> # WHERE people's actual defect lives: branching on the PRESENCE of a settle.
> # Legitimate on cards whose buttons cannot disagree, so read every hit; on the
> # "shall I remember this?" card it prints "Saved" after _Don't save_.
> grep -n 'typeof result === "string"' src/skins/*/tools.tsx
> ```
>
> Where a compliant skin diverges from banking on a load-bearing detail, the
> divergence is called out inline as a **Per-skin divergence** note. Read this
> file, and run both commands, before building the next one.

"Teach mode" is the loop where the agent **fails a task it was never told how to
do**, a human **demonstrates** the workaround in the UI, that demonstration is
captured and (in Intelligence mode) saved to durable memory, and a **fresh agent
then succeeds unaided**. The agent didn't have the recipe prompt-stuffed in — it
learned it from watching a person.

In the banking skin the gated task is **approving an over-policy-limit charge**.

---

## The teachable loop

The whole thing turns on one asymmetry: **the agent is given the goal and the
tools, but NOT the procedure.** A gate blocks the obvious write with a
symptom-only error. A human knows the unlock and performs it in the UI. That
action is captured; a later agent applies it on its own.

```
   Agent A (knows the goal + tools, NOT the procedure) tries the obvious write
                                   │
                                   ▼
   GATE     ──► the write FAILS with a SYMPTOM-ONLY error
                ("<policy> policy limit exceeded", HTTP 422 OVER_POLICY_LIMIT)
                names the PROBLEM, never the FIX
                                   │
                                   ▼
   FRAMING  ──► the prompt withholds the recipe + ships DISTRACTOR tools +
                an ACTION DISCIPLINE clause ⇒ the agent CANNOT bluff past it;
                it declines and offers to learn.
                                   │
                                   ▼
   UNLOCK   ──► a HUMAN performs the multi-step workaround on the dashboard:
                file an exception under a JUSTIFYING code → finalize → link it
                (DECOY codes file but don't justify; INVALID codes are rejected)
                                   │
                                   ▼
   SAVE     ──► the agent summarizes the demonstrated procedure and, in
                Intelligence mode, persists it via save_memory (project scope)
                                   │
                                   ▼
   Agent B (FRESH thread, no memory of A) recall_memory → applies the SAME
   procedure to a DIFFERENT over-limit charge, UNAIDED   ◄── proof of LEARNING
```

The **gate → unlock** half is verifiable today with no Intelligence backend (it
is a pure REST contract — see Verification). The **save → recall → fresh agent
succeeds** half is durable only in Intelligence mode; in OSS mode the agent can
still learn within a single conversation, but nothing persists across threads.

---

## The 5-role contract (with the load-bearing invariants)

Stated demo-agnostically. The **invariant** is the part that makes the demo
_prove learning_ rather than merely _script a workflow_.

### 1. GATE — a write that fails with a SYMPTOM-ONLY error

Approving an over-limit charge is blocked; the rejection names the problem, never
the fix.

> **Invariant.** The error is symptom-only. It may say _"\<policy\> policy limit
> exceeded"_; it must NEVER mention the policy-exception path. Leaking the recipe
> in the error lets the agent derive it in one round-trip and defeats the demo.
> The gate must also be _liftable_ — it passes once the unlock is in place
> (within limit, OR an approved justifying exception is linked).

### 2. UNLOCK — a discriminating multi-step procedure that lifts the gate

A human (and, post-learning, the agent) lifts the gate by **filing an exception
under a JUSTIFYING code → finalizing it → linking it** to the charge. The
catalogue mixes justifying codes with **decoys**, and unknown codes are
**rejected without enumeration**.

> **Invariant.** The procedure is _discriminating_: only JUSTIFYING codes lift
> the gate; DECOY codes file successfully (recorded for history) but do NOT
> justify; INVALID codes are rejected _without listing the valid ones_. The agent
> is **never told which codes justify** — it must learn that from the observed
> human flow.

### 3. RECORDING — the demonstration is captured on the current thread

While the human demonstrates, the agent holds the chat with a non-directional
waiting card and a live recorder feed that narrates each action as it happens
("Opened Dashboard" → "Filed the policy exception" → "Approved the charge").

> **Invariant.** The waiting card stays non-directional — it never lists the
> steps, because the point is the agent doesn't yet know them. The contrast
> between the gated state and the unlocked effect is the signal the save distills.

> **Invariant (survives replay).** Everything a teach-chain card prints must
> travel INSIDE the tool result the card reads back. The recording context is
> live-session state and is empty when a stored thread is reopened — which is
> exactly when the "threads store AG-UI streams, not text" beat is on screen. So
> the recorder REPORTS its step count in the directive and the card prints the
> reported number. A card that re-derives a fact by parsing its own rendering
> (counting `N.` matches in the step prose) announces a different number than the
> list under it as soon as a step label contains a numeral. Worked example, with
> the round-trip test that pins builder to reader:
> `src/skins/commerce/teach-mode-directives.ts`.

> **Invariant (a settle is not an answer).** The "shall I remember this?" card
> settles with a string on BOTH buttons, so `typeof result === "string"` tells you
> the card was answered and NOTHING about the answer. Classify the directive;
> never branch on mere presence, and never treat an unrecognized settle as a
> success. Getting this wrong prints "Saved. I'll use this next time" after the
> presenter clicked _Don't save_ — a durable write asserted on stage that never
> happened — and it mis-renders the same way on every later replay of the thread.

### 4. AGENT FRAMING — withhold the recipe, ship distractors, enforce discipline

The system prompt lists the unlock's tools but **never the procedure**, and ships
**plausible distractor tools** that look helpful but don't lift the gate. An
**ACTION DISCIPLINE** clause forbids improvising a substitute.

> **Invariant.** A successful unlock must prove **learning, not prompt-stuffing**.
> So: (a) the prompt withholds the recipe; (b) it ships distractors
> (`sendSpendAlert` / `requestCardReplacement` / `flagForReview`) so "called a
> plausible tool" ≠ "cleared the gate"; (c) ACTION DISCIPLINE makes the agent stop
> and offer to learn rather than guess. Before learning, the correctly-framed
> agent _cannot_ pass.

### 5. KNOWLEDGE BACKEND — save → recall → fresh agent learns

The demonstrated procedure is saved to durable memory; a fresh agent recalls it
and succeeds unaided. The runtime is **env-gated**: OSS `InMemoryAgentRunner` by
default, `CopilotKitIntelligence` when configured.

> **Invariant.** The backend is a **swappable seam**, and roles #1–#2 are proven
> _without_ it. In OSS mode the loop works within one conversation only; durable
> cross-thread / cross-user recall requires Intelligence mode (the
> `recall_memory` / `save_memory` tools attach from the memory-enabled backend).

> **Invariant (recall before declining).** The prompt must make the agent
> `recall_memory` FIRST on every refusal and branch on what comes back. A prompt
> that states "you have no saved way past this" as a flat fact makes the agent
> decline and offer to record even after it has been taught: the demonstration
> works, the memory saves correctly, and the payoff never arrives — the prompt
> overrode what the agent knew.

> **Per-skin divergence — memory SCOPE.** `banking` saves the learned procedure at
> `scope:"project"`. Later skins save at `scope:"user"` and say so in their
> prompts, because one Intelligence backend is shared by every product in this
> deployment: a project-scoped procedure is visible to skins that never learned
> it. Prefer `"user"` for a new skin unless it genuinely owns its own backend.
>
> There is a second, harder reason, and it is the one that decides the question.
> A skin whose `intelligence/forget-memories.ts` **skips project-scoped rows** —
> `logistics` and `commerce` both do, so that a Meridian reset cannot delete
> banking's seeded procedure out from under it — has a presenter reset that
> physically cannot un-teach a project-scoped memory. Save beat 6's procedure at
> project scope in such a skin and the SECOND run of the demo opens with the agent
> already knowing the answer: it never declines, never offers to record, and the
> beat proves nothing while looking perfect. Check what your skin's sweep actually
> deletes before choosing a scope. Keeping beat 5's seeded procedure and beat 6's
> learned one distinguishable is then a job for their TEXT and the prompt clauses
> that route to them — each says plainly that it is not the other — not for the
> scope field.

> **Per-skin divergence — tool names.** The chain's shape is fixed (offer → wait →
> summarize → confirm → persist); the names are not. `banking` calls the middle
> two `awaitDashboardDemonstration` / `saveLearnedWorkflow`; later skins call them
> `awaitDemonstration` / `saveLearnedProcedure`. Match your skin, not this page —
> and note the grep at the top keys on `offerWorkflowRecording`, which all of them
> share.

---

## Where each role lives (banking skin)

| Role                     | File(s)                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#1 GATE**              | `src/app/api/banking/v1/transactions/[id]/route.ts` — PUT returns **422 `OVER_POLICY_LIMIT`** when an approve would exceed the policy limit and no approved exception is linked. Rule helpers in `src/skins/banking/data/store.ts`.                                                                                                                                                                                   |
| **#2 UNLOCK**            | Catalogue `src/skins/banking/data/policy-exception-codes.ts` (`POLICY_EXCEPTION_CODES`, `JUSTIFYING_EXCEPTION_CODES`, `isValidExceptionCode`, `isJustifying`). REST `src/app/api/banking/v1/exceptions/route.ts` (open, POST) + `src/app/api/banking/v1/exceptions/[id]/finalize/route.ts` (finalize, POST).                                                                                                          |
| **#3 RECORDING**         | **Shell-owned, not per skin** — `src/shell/teach/` (`RecordingProvider`, `useRecording`, `RecordingFeed`, `RecordingVignette`; the glow's CSS is `.recording-vignette` in `src/app/globals.css`, valued from each skin's `--brand-violet` / `--brand-indigo`). Banking, people and commerce each shipped a private copy that diverged; all three now import the one module. Only the `logStep` LABELS are the skin's. |
| **#4 AGENT FRAMING**     | `src/skins/banking/agent.ts` — the `BuiltInAgent` prompt withholds the recipe, ships the three distractors, and carries the ACTION DISCIPLINE clause. It also defines the teach-flow HITL tools it orchestrates: `offerWorkflowRecording` → `awaitDashboardDemonstration` → `saveLearnedWorkflow`, plus `recall_memory` / `save_memory`.                                                                              |
| **#5 KNOWLEDGE BACKEND** | `src/app/api/copilotkit/[[...slug]]/route.ts` — env-gated `CopilotKitIntelligence` (OSS `InMemoryAgentRunner` default) keyed on `INTELLIGENCE_API_URL` / `INTELLIGENCE_GATEWAY_WS_URL` / `INTELLIGENCE_API_KEY`; `enableEnterpriseLearning` + `exposeMemoryRoutes` wire the memory tools and the inspector's Memory tab. `identifyUser` scopes memory by member/role.                                                 |

The narrated variant: when asked to approve an over-limit charge it has no saved
procedure for, the agent declines ("I don't have a saved way to approve an
over-limit charge yet") and calls `offerWorkflowRecording` — no approval card is
shown. The officer demonstrates on the real dashboard (Transactions → Pending →
file a justifying exception → approve) while `awaitDashboardDemonstration` holds
the chat; the agent then `saveLearnedWorkflow` + `save_memory`, and on a later
request applies it to a _different_ over-limit charge via `openPolicyException` →
`finalizePolicyException` → `approveTransaction`. Because the demonstration
happens on a different route, the teach/recall tools are registered by the skin's
`Tools` component (not a single page) so they survive navigation.

---

## Verification

### Backend-independent proof (works today) — roles #1 + #2

Run the bundled script against a running dev server. It drives the real REST
routes and asserts the full gate→unlock contract over HTTP, with no Intelligence
stack required.

```bash
pnpm dev                                    # in another shell (defaults to :3000)
./verify-teachable-gate.sh                  # BASE_URL defaults to http://localhost:3000
BASE_URL=http://localhost:3000 ./verify-teachable-gate.sh
```

It asserts, in order:

- **A. GATE (#1)** — approving an over-limit charge → **422 `OVER_POLICY_LIMIT`**,
  and the body does **not** mention the exception/unlock path (symptom-only).
- **B. UNLOCK (#2)** — open a justifying exception → finalize → re-approve the
  same charge → **201** (gate lifted).
- **C. DECOY (#2)** — a non-justifying code files + finalizes but the approve
  stays **422**.
- **D. CATALOGUE (#2)** — an invalid code → **422 `INVALID_EXCEPTION_CODE`**,
  without enumerating the real catalogue.

> The store is in-memory and seeded from `src/skins/banking/data/seed.json`. Each
> scenario uses a different seeded over-limit transaction, so one run needs no
> reset. To re-run from scratch, restart the dev server, or `POST` the skin's
> gated presenter-reset route (`/api/banking/v1/dev/reset`, enabled by
> `PRESENTER_RESET_ENABLED=true`; the sidebar Reset button hits the same route).
>
> **Prefer the reset route before the learning proof below.** Restarting the dev
> server re-seeds the in-memory store and nothing else — durable memory lives in
> the Intelligence backend and survives it. The reset route also forgets and
> re-seeds that memory, which is the only thing that puts the demo back into a
> genuinely _un-taught_ state. It reports a `memoryError` when that half fails;
> that sentence is the only warning that the loop is starting out already taught,
> so surface it rather than collapsing the response to a status code.

### Fresh-agent learning proof — roles #3 + #5 (Intelligence mode)

This proves the loop _learned_, not that the REST works. It needs the env-gated
`CopilotKitIntelligence` runtime configured (`INTELLIGENCE_API_URL`,
`INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY`).

1. **Baseline.** Reset first (above) — durable memory outlives a dev-server
   restart, so an un-reset run starts out already taught and the control passes
   vacuously. Then, in a fresh thread, ask the agent to approve an over-limit
   charge. With role #4 framing intact it declines and offers to record — it does
   not fire a distractor. _This is the control._
2. **Teach.** The human demonstrates the unlock on the dashboard (justifying code
   → finalize → approve) while the recorder card narrates each step.
3. **Save.** The agent summarizes and calls `save_memory` (`kind:"operational"`;
   `scope:"project"` in banking, `"user"` in the later skins — see role #5).
4. **Fresh agent succeeds.** In a **new** thread (no memory of the human's
   session), ask to approve a _different_ over-limit charge. The agent
   `recall_memory` → files a justifying exception → finalizes → approves —
   unaided, with nothing added to the prompt.

Pass criteria: step 1 declines, step 4 succeeds, and the only thing that changed
is the saved procedure. That delta is the learning. The deterministic CI version
of this is `pnpm test:self-learning` (`e2e/memory-learning.spec.ts`), which drives
the flow with an aimock-served LLM against the real local memory backend.
