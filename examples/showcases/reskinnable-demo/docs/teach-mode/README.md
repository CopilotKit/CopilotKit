# teach-mode — the banking skin's teachable over-limit flow

> Scope: this documents a feature of the **`banking` skin**
> (`src/skins/banking/`), not the whole app. The app is a reskinnable shell that
> hosts one skin per `/[skin]` route; see the top-level `CLAUDE.md`. Teach-mode
> is banking-specific — the airline skin does not implement it.

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

---

## Where each role lives (banking skin)

| Role                     | File(s)                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#1 GATE**              | `src/app/api/banking/v1/transactions/[id]/route.ts` — PUT returns **422 `OVER_POLICY_LIMIT`** when an approve would exceed the policy limit and no approved exception is linked. Rule helpers in `src/skins/banking/data/store.ts`.                                                                                                                                   |
| **#2 UNLOCK**            | Catalogue `src/skins/banking/data/policy-exception-codes.ts` (`POLICY_EXCEPTION_CODES`, `JUSTIFYING_EXCEPTION_CODES`, `isValidExceptionCode`, `isJustifying`). REST `src/app/api/banking/v1/exceptions/route.ts` (open, POST) + `src/app/api/banking/v1/exceptions/[id]/finalize/route.ts` (finalize, POST).                                                          |
| **#3 RECORDING**         | `src/skins/banking/components/recording-context.tsx` + the recorder feed / vignette components under `src/skins/banking/components/`.                                                                                                                                                                                                                                 |
| **#4 AGENT FRAMING**     | `src/skins/banking/agent.ts` — the `BuiltInAgent` prompt withholds the recipe, ships the three distractors, and carries the ACTION DISCIPLINE clause. It also defines the teach-flow HITL tools it orchestrates: `offerWorkflowRecording` → `awaitDashboardDemonstration` → `saveLearnedWorkflow`, plus `recall_memory` / `save_memory`.                              |
| **#5 KNOWLEDGE BACKEND** | `src/app/api/copilotkit/[[...slug]]/route.ts` — env-gated `CopilotKitIntelligence` (OSS `InMemoryAgentRunner` default) keyed on `INTELLIGENCE_API_URL` / `INTELLIGENCE_GATEWAY_WS_URL` / `INTELLIGENCE_API_KEY`; `enableEnterpriseLearning` + `exposeMemoryRoutes` wire the memory tools and the inspector's Memory tab. `identifyUser` scopes memory by member/role. |

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
> reset. To re-run from scratch, restart the dev server to reseed.

### Fresh-agent learning proof — roles #3 + #5 (Intelligence mode)

This proves the loop _learned_, not that the REST works. It needs the env-gated
`CopilotKitIntelligence` runtime configured (`INTELLIGENCE_API_URL`,
`INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY`).

1. **Baseline.** In a fresh thread, ask the agent to approve an over-limit
   charge. With role #4 framing intact it declines and offers to record — it does
   not fire a distractor. _This is the control._
2. **Teach.** The human demonstrates the unlock on the dashboard (justifying code
   → finalize → approve) while the recorder card narrates each step.
3. **Save.** The agent summarizes and calls `save_memory` (`scope:"project"`,
   `kind:"operational"`).
4. **Fresh agent succeeds.** In a **new** thread (no memory of the human's
   session), ask to approve a _different_ over-limit charge. The agent
   `recall_memory` → files a justifying exception → finalizes → approves —
   unaided, with nothing added to the prompt.

Pass criteria: step 1 declines, step 4 succeeds, and the only thing that changed
is the saved procedure. That delta is the learning. The deterministic CI version
of this is `pnpm test:self-learning` (`e2e/memory-learning.spec.ts`), which drives
the flow with an aimock-served LLM against the real local memory backend.
