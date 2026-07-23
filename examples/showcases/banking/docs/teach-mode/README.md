# teach-mode cookbook

A reusable recipe for building **self-learning, teachable** CopilotKit demos.

"Teach mode" is the loop where an agent **fails a task it was never told how to
do**, a human **demonstrates** the workaround in the UI, that demonstration is
**recorded → distilled → written to `/knowledge`**, and a **fresh agent then
succeeds unaided**. The agent didn't have the recipe prompt-stuffed in; it
_learned_ it from watching a person.

This loop is already implemented **identically** in two demos — only the domain
entities differ. This cookbook documents the contract they share so a **third
demo is a copy-and-reskin**, not a redesign.

| Demo                       | Path                                        | Entities                                              |
| -------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| **Banking** (canonical)    | `examples/showcases/banking`                | `transaction` / `expense-policy` / `policy-exception` |
| **E-commerce** (reference) | `cpk-intelligence-banking/demos/e-commerce` | `order` / `refund` / `incident-report`                |

> Paths in this doc are repo-relative to `CopilotKit/` for banking, and to
> `cpk-intelligence-banking/` for e-commerce.

---

## (a) What teach-mode is — the teachable loop

The whole demo turns on one asymmetry: **the agent is given the goal and the
tools, but NOT the procedure.** A gate blocks the obvious write with a
symptom-only error. A human knows the unlock and performs it in the UI. That
human action is captured and distilled into knowledge. A later agent reads the
knowledge and clears the same gate on its own.

```
                         ┌─────────────────────────────────────────────┐
                         │  Agent A (knows the goal + tools, NOT the    │
                         │  procedure) tries the obvious write          │
                         └───────────────────────┬─────────────────────┘
                                                 │
                                                 ▼
   role #1 GATE  ──►  write FAILS with a SYMPTOM-ONLY error  ─────────────┐
                      ("<policy> policy limit exceeded" — 422)            │
                      names the PROBLEM, never the FIX                    │
                                                                          ▼
   role #4 AGENT FRAMING: prompt withholds the recipe + ships DISTRACTOR  │
   tools + ACTION DISCIPLINE  ──►  agent CANNOT bluff its way past;       │
   it stops and reports.                                                  │
                                                                          ▼
   role #2 UNLOCK: a HUMAN performs the multi-step workaround in the UI   │
      file a record under a JUSTIFYING code → finalize → link to entity   │
      (DECOY codes file but don't justify; INVALID codes are rejected)    │
                                                                          │
                                ┌─────────────────────────────────────────┘
                                ▼
   role #3 RECORDING: each human UI mutation is captured on the CURRENT
      thread via useRecordUserActionInCurrentThread()
          recordUserAction({ title, description, previousData, newData, metadata })
      previousData = the gated flags · newData = the unlocked effect
                                │
                                ▼
   role #5 KNOWLEDGE BACKEND: writer agent DISTILLS the recorded actions
      ────►  /knowledge  (a reusable "to clear this gate, do X" procedure)
                                │
                                ▼
                         ┌─────────────────────────────────────────────┐
                         │  Agent B (FRESH, no memory of A) retrieves   │
                         │  /knowledge and clears the SAME gate UNAIDED │  ◄── proof of LEARNING
                         └─────────────────────────────────────────────┘
```

The left half (gate → symptom → framing → human unlock → recording call) works
and is **verifiable today** with no Intelligence backend. The right half
(distill → `/knowledge` → fresh agent) activates when the self-learning
react-core + Intelligence runtime are wired — see role #5 and the honest
backend-block note in **(e)**.

> **Banking's narrated dashboard variant (PR #5266).** On top of this contract,
> the banking demo drives the unlock as an _agent-orchestrated, narrated_ loop.
> When asked to approve an over-limit charge it has no saved procedure for, the
> agent declines ("I don't have a saved way to approve an over-limit charge yet")
> and offers to record (`offerWorkflowRecording`) — no approval card is shown.
> The officer demonstrates the unlock on the real **/dashboard → Transactions →
> Pending approval** view (file a justifying exception, then approve) while a
> waiting card (`awaitDashboardDemonstration`) holds the chat; the agent then
> summarizes and saves the procedure (`saveLearnedWorkflow`) and, on a later
> request, applies it itself to a _different_ over-limit charge
> (`openPolicyException` → `finalizePolicyException` → `approveTransaction`).
> Because the demonstration happens on a different route, these teach/recall HITL
> tools are registered **globally** in `src/components/copilot-context.tsx` (not
> in a page component) so they survive navigation — a route-scoped registration
> unmounts mid-run and the followUp never fires. Same-session recall works by
> echoing the saved procedure back into the thread; the cross-thread `/knowledge`
> proof still requires the backend (role #5).
>
> The waiting card ("Recording your workflow") stays **non-directional** — it
> never lists the steps ("go ahead and do it yourself now and I'll watch and
> learn"), since the point is the agent doesn't yet know how. The card embeds a
> live **recorder feed** (`RecordingSteps` in `src/components/recording-feed.tsx`,
> fed by `logStep` from the nav / tab / file-exception / approve call sites) that
> narrates each officer action as it happens ("Opened Dashboard" → "Filed the
> policy exception" → "Approved the charge"). It renders INSIDE the chat card (a
> child component subscribed to the recording context, so it updates live without
> a stale-closure dep), reading consistently with the other cards rather than as
> a floating overlay. `saveLearnedWorkflow`'s tool result is
> **directive** so the model renders the Save card instead of asking "should I
> save this?" in prose (the failure that otherwise leaves the user nothing to
> click). After saving, the agent treats the demonstrated charge as already
> cleared and waits, rather than re-running the fresh procedure on it.

---

## (b) The 5-role contract (with load-bearing invariants)

State each role demo-agnostically. The **invariant** is the part you must not
break when reskinning — it's what makes the demo _prove learning_ rather than
merely _script a workflow_.

### 1. GATE — a write that fails with a SYMPTOM-ONLY error

A normal-looking write (approve, refund, …) is blocked when a domain rule isn't
satisfied. The rejection **names the problem, never the fix**.

> **Invariant.** The error is symptom-only. It may say _"\<policy\> policy limit
> exceeded"_; it must NEVER mention the policy-exception path (or whatever the
> unlock is). Leaking the recipe in the error lets the agent derive it in one
> round-trip and defeats the demo. The gate must also be _liftable_ — it passes
> once the unlock is in place (`isWithinLimit(x) || hasApprovedException(x)`).

### 2. UNLOCK — a discriminating multi-step procedure that lifts the gate

A human (and, post-learning, the agent) lifts the gate by **filing a record
under a JUSTIFYING code → finalizing it → linking it** to the entity. The
catalogue mixes justifying codes with **decoys**, and unknown codes are
**rejected without enumeration**.

> **Invariant.** The procedure is _discriminating_: only JUSTIFYING codes lift
> the gate; DECOY codes file successfully (recorded for history) but do NOT
> justify; INVALID codes are rejected _without listing the valid ones_. The
> agent is **never told which codes justify** — it must learn that from observed
> human flows. (If any code worked, or the catalogue were leaked, there'd be
> nothing to learn.)

### 3. RECORDING surface — human UI mutations captured on the current thread

Every human mutation that advances the unlock is recorded on the current thread
via `useRecordUserActionInCurrentThread()`, called as
`recordUserAction({ title, description, previousData, newData, metadata }).catch(...)`.

> **Invariant.** The record shape is fixed and identical across demos:
> `previousData` carries the **gated capability flags** (e.g.
> `approvePermitted: false`), `newData` the **unlocked effect** (flipped flags +
> linking ids), `metadata` the **domain ids**. `title` is a machine-ish dotted
> event name (e.g. `policy_exception.opened`); `description` is one human
> sentence. The contrast between `previousData` and `newData` is the signal the
> distiller learns from — keep flag names stable across the open→finalize steps.

### 4. AGENT FRAMING — withhold the recipe, ship distractors, enforce discipline

The system prompt lists the unlock's tools but **never the procedure**, and
ships **plausible distractor tools** that look helpful but don't lift the gate.
An **ACTION DISCIPLINE** clause forbids improvising a substitute.

> **Invariant.** A successful unlock must prove **learning, not
> prompt-stuffing**. So: (a) the prompt withholds the unlock recipe; (b) it
> ships distractors (banking: `sendSpendAlert`, `requestCardReplacement`,
> `flagForReview`) so "called a plausible tool" ≠ "cleared the gate"; (c) ACTION
> DISCIPLINE makes the agent stop and report on failure rather than guess. Before
> learning, the correctly-framed agent _cannot_ pass.

### 5. KNOWLEDGE BACKEND — record → distill → `/knowledge` → fresh agent learns

Recorded actions are distilled into `/knowledge`; a fresh agent retrieves it and
succeeds unaided. The runtime is **env-gated**: OSS `InMemoryAgentRunner` by
default, `CopilotKitIntelligence` when configured.

> **Invariant.** The backend is a **swappable seam**, and roles #1–#2 are proven
> _without_ it. **Honest current block:** the OSS `@copilotkit/react-core/v2`
> build does **not** yet export the recording hook, so the recording surface
> (role #3) is a **no-op shim** today — gate/unlock/framing all work and verify,
> but the distill→`/knowledge`→fresh-agent leg is deferred until the
> self-learning react-core ships. The hook exists at CopilotKit commit
> `e103a19` (pinned by the Intelligence repo); adoption is then a **one-line
> import swap** (call sites don't change). See **(e)**.

---

## (c) Worked-example mapping table

Each role → the banking file → the e-commerce file → what you swap for a new demo.

| Role                     | Banking (`examples/showcases/banking`)                                                                                                                                                                                                                                                                                                        | E-commerce (`cpk-intelligence-banking/demos/e-commerce`)                                                                                                                                                                                   | What you swap for a new demo                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#1 GATE**              | `src/app/api/v1/transactions/[id]/route.ts` — PUT returns **422 `OVER_POLICY_LIMIT`** when `status==="approved" && !isWithinPolicyLimit && !hasApprovedException`. Rule fns in `src/lib/store.ts`: `isWithinPolicyLimit` / `hasApprovedException` / `canApprove`.                                                                             | `react/src/app/data/store.ts` — `processRefund` / `initiateReturn` throw **`REFUND_NOT_PERMITTED` / `RETURN_NOT_PERMITTED`** when `!isWithinRefundWindow && !hasApprovedActiveIncident`.                                                   | The gated write + its symptom-only error code. Pick your domain's "blocked action" (publish, ship, escalate…) and the rule that blocks it.                                  |
| **#2 UNLOCK**            | Catalogue `src/app/api/v1/policy-exception-codes.ts` (`POLICY_EXCEPTION_CODES`, `JUSTIFYING_EXCEPTION_CODES`, `isValidExceptionCode`, `isJustifying`). REST `src/app/api/v1/exceptions/route.ts` (open, POST) + `src/app/api/v1/exceptions/[id]/finalize/route.ts` (finalize, POST). Store `openPolicyException` / `finalizePolicyException`. | Catalogue `react/src/app/data/incident-codes.ts` (`INCIDENT_CODES`, `REFUND_JUSTIFYING_CODES`, `isValidIncidentCode`). Store `openIncidentReport` / `finalizeIncidentReport`.                                                              | The record entity + its code catalogue. Keep 3 justifying + N decoys; keep open→finalize→link; keep the catalogue check that rejects unknown codes **without enumerating**. |
| **#3 RECORDING**         | `src/lib/record-user-action.ts` (**no-op shim**) → consumed in `src/components/policy-exception-modal.tsx` (two `recordUserAction` calls: `policy_exception.opened` then `.finalized`).                                                                                                                                                       | `@copilotkit/react-core/v2` (**real hook import**) → consumed in `react/src/app/components/incident-create-modal.tsx` (`incident_report.opened` / `.finalized`) and `order-actions-bar.tsx` (`order.refunded` / `order.return_initiated`). | Nothing in the seam itself — copy `record-user-action.ts` verbatim. Swap only the **payload values** (`title`/flags/`metadata`) for your domain.                            |
| **#4 AGENT FRAMING**     | `src/app/api/copilotkit/[[...slug]]/route.ts` — `BuiltInAgent` prompt withholds the unlock recipe; ships distractors `sendSpendAlert` / `requestCardReplacement` / `flagForReview`; has the **ACTION DISCIPLINE** clause.                                                                                                                     | Same role in the e-commerce runtime route (refund/return tools listed; distractors present; recipe withheld).                                                                                                                              | The prompt's tool list, your 3 distractor tools, and the ACTION DISCIPLINE clause (reuse the wording — it's domain-neutral).                                                |
| **#5 KNOWLEDGE BACKEND** | Same route — env-gated `CopilotKitIntelligence` (OSS `InMemoryAgentRunner` default) keyed on `INTELLIGENCE_API_URL` / `INTELLIGENCE_GATEWAY_WS_URL` / `INTELLIGENCE_API_KEY`; `identifyUser` scopes threads by role.                                                                                                                          | Equivalent env-gated Intelligence runtime in the e-commerce app.                                                                                                                                                                           | Nothing structural — reuse the env-gated `createRuntime()` pattern verbatim; only `agents: { default: <yourAgent> }` changes.                                               |

---

## (d) Adoption checklist — add teach-mode to a new demo

Eight concrete steps. Assumes a CopilotKit demo with an in-memory store and a v2
runtime route already scaffolded.

1. **Pick the gated write + symptom.** Choose the domain action to block
   (approve / refund / publish / ship …) and the rule that blocks it. Add the
   rule fns to your store (mirror `isWithinPolicyLimit` / `hasApprovedException`
   / `canApprove`). Make the write's route return a **422 with a symptom-only
   error code** (mirror `OVER_POLICY_LIMIT` in
   `transactions/[id]/route.ts`). **Do not name the unlock in the error.**

2. **Author the code catalogue (role #2).** Create a `*-codes.ts` (mirror
   `policy-exception-codes.ts`): a `CODES` array (`{ code, label }`, label for
   humans only), a `JUSTIFYING_CODES` set (keep ~3), `isValid*Code`, and
   `isJustifying`. Include **decoy** codes that are valid-but-not-justifying.

3. **Add the unlock record + REST.** Add the record entity to your store with
   `open*` (validates code via `isValid*Code`, throws on unknown) and
   `finalize*` (auto-approves and links `active*Id` to the gated entity, which is
   what `hasApprovedException` checks). Expose them over REST (mirror
   `exceptions/route.ts` + `exceptions/[id]/finalize/route.ts`) — or as store
   calls if your demo is client-side like e-commerce.

4. **Copy the recording seam (role #3).** Copy
   [`record-user-action.ts`](../../src/lib/record-user-action.ts) into your `src/lib/`
   **verbatim**. It is domain-neutral; do not edit it.

5. **Wire the human UI to record (role #3).** In the modal/bar where the human
   performs the unlock, call `useRecordUserActionInCurrentThread()` and emit a
   record after each successful mutation. Follow the field convention exactly:
   `previousData` = gated flags (`{ approvePermitted: false }`), `newData` =
   unlocked effect (flipped flags + linking ids), `metadata` = domain ids,
   `title` = dotted event name, `description` = one sentence. Always
   `.catch(...)` (fire-and-forget). Mirror `policy-exception-modal.tsx`.

6. **Frame the agent (role #4).** In your runtime route's prompt: list the
   unlock's tools but **not the procedure**; add **3 distractor tools** that look
   plausible but don't lift the gate; paste the **ACTION DISCIPLINE** clause
   (reuse banking's wording). Implement the distractors as harmless no-ops/logs.

7. **Wire the env-gated backend (role #5).** Reuse banking's `createRuntime()`:
   build `CopilotKitIntelligence` when `INTELLIGENCE_API_URL` /
   `INTELLIGENCE_GATEWAY_WS_URL` / `INTELLIGENCE_API_KEY` are all set, else fall
   back to `InMemoryAgentRunner`. Keep `identifyUser` to scope threads by role.

8. **Verify (role #1+#2 today; #5 when the backend lands).** Adapt
   [`verify-teachable-gate.sh`](./verify-teachable-gate.sh) to your entity ids
   and codes and run it against your dev server. It must show: gate blocks (422)
   → justifying unlock succeeds → decoy stays blocked → invalid code rejected
   without leaking the catalogue. Add the fresh-agent learning proof (**(f)**)
   once the Intelligence backend is configured.

---

## (e) The RECORDING SEAM contract

The canonical primitive lives in
[`record-user-action.ts`](../../src/lib/record-user-action.ts) — copy it once, never edit
it.

### The `UserActionRecord` shape

```ts
export type UserActionRecord = {
  title: string; // machine-ish dotted event name
  description: string; // one human sentence
  previousData?: unknown; // GATED state (flags that were false)
  newData?: unknown; // UNLOCKED effect (flipped flags + ids)
  metadata?: Record<string, unknown>; // domain ids ("which")
};

export const useRecordUserActionInCurrentThread =
  () =>
  (record: UserActionRecord): Promise<void> => {
    /* … */
  };
```

Call-site convention, verbatim from `policy-exception-modal.tsx` (the e-commerce
modal is identical bar the entity names):

```ts
const recordUserAction = useRecordUserActionInCurrentThread();
// ...after open() succeeds...
recordUserAction({
  title: "policy_exception.opened",
  description: "Opened a policy exception from the transactions view.",
  previousData: { transactionActiveExceptionId: null, approvePermitted: false },
  newData: { exceptionId, exceptionStatus: "draft", exceptionCode: code },
  metadata: { transactionId: props.transactionId },
}).catch(console.error);
// ...then after finalize() succeeds, a second record flips the flags to the unlocked state.
```

### The no-op shim (current state)

Today the shim **records nothing** — it only `console.debug`s in dev — because
the OSS `@copilotkit/react-core/v2` build does **not** export
`useRecordUserActionInCurrentThread`. Its hooks index exports only
`useFrontendTool` / `useHumanInTheLoop` / `useAgent` / `useThreads` / etc. The
shim exists purely to keep the call sites real and stable.

### The one-line swap to the real hook

When a react-core build exporting the hook is one you can depend on, change
**only the import** at each call site:

```ts
// before — no-op shim (banking today):
import { useRecordUserActionInCurrentThread } from "@/lib/record-user-action";

// after — real hook (e-commerce already does this):
import { useRecordUserActionInCurrentThread } from "@copilotkit/react-core/v2";
```

The `UserActionRecord` type and every call body stay byte-for-byte identical.
(Alternatively, make `record-user-action.ts` re-export the real hook so not even
imports change.)

### Honest backend-block note

- **Works today, no backend:** roles #1 (gate), #2 (unlock + decoy + catalogue),
  #4 (framing). Provable via `verify-teachable-gate.sh`.
- **Deferred until the self-learning react-core + Intelligence runtime are
  wired:** the recording actually streaming (role #3 beyond the no-op) and the
  distill → `/knowledge` → fresh-agent-learns leg (role #5).
- **Known landing point:** the recording hook exists at CopilotKit commit
  `e103a19`, which the Intelligence repo pins. The banking demo points its
  import at the shim; the e-commerce demo already imports the hook from
  `@copilotkit/react-core/v2` — that single import line is the entire difference
  between "backend pending" and "backend wired".

---

## (f) Verification recipe

### Backend-independent proof (works TODAY) — roles #1 + #2

Run the bundled script against a running banking dev server. It drives the real
REST routes and asserts the full gate→unlock contract.

```bash
# default base URL is http://localhost:3939 (next dev defaults to :3000 —
# point BASE_URL at whatever port you actually serve)
./verify-teachable-gate.sh
BASE_URL=http://localhost:3000 ./verify-teachable-gate.sh
```

What it asserts (each step commented in the script with the role it exercises):

- **A. GATE (#1)** — `PUT /api/v1/transactions/t-1 {"status":"approved"}` →
  **422 `OVER_POLICY_LIMIT`**, and the body does **not** mention the
  exception/unlock path (symptom-only invariant).
- **B. UNLOCK (#2)** — `POST /api/v1/exceptions {transactionId:"t-1",
code:"EXC-BOARD-APPROVED"}` → **201** → `POST
/api/v1/exceptions/{id}/finalize` → **200 approved** → re-`PUT` approve `t-1`
  → **201** (gate lifted).
- **C. DECOY (#2)** — same flow on `t-3` with `EXC-WILL-REIMBURSE` files +
  finalizes (**201/200**) but the approve stays **422 `OVER_POLICY_LIMIT`**.
- **D. CATALOGUE (#2)** — `POST /api/v1/exceptions {code:"EXC-…NOT-REAL"}` →
  **422 `INVALID_EXCEPTION_CODE`**, and the body does **not** enumerate any real
  catalogue codes (non-enumeration invariant).

> The store is in-memory and seeded from `src/data/seed.json`. Each scenario uses
> a different seeded over-limit transaction (`t-1`, `t-3`, `t-2`), so one run
> needs no reset. To re-run from scratch, **restart the dev server** to reseed.

Minimal manual equivalent of the gate→unlock payoff:

```bash
BASE=http://localhost:3939/api/v1
# A. gate blocks
curl -s -X PUT  "$BASE/transactions/t-1" -H 'content-type: application/json' \
  -d '{"status":"approved"}'                                  # -> 422 OVER_POLICY_LIMIT
# B. unlock
EXC=$(curl -s -X POST "$BASE/exceptions" -H 'content-type: application/json' \
  -d '{"transactionId":"t-1","code":"EXC-BOARD-APPROVED"}' | jq -r .id)
curl -s -X POST "$BASE/exceptions/$EXC/finalize"              # -> 200 approved
curl -s -X PUT  "$BASE/transactions/t-1" -H 'content-type: application/json' \
  -d '{"status":"approved"}'                                  # -> 201 (now allowed)
```

### Fresh-agent learning proof (activates once the backend lands) — roles #3 + #5

This is the proof that the loop _learned_, not that the REST works. It requires
the recording hook (real, not the shim) and the env-gated `CopilotKitIntelligence`
runtime configured (`INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`,
`INTELLIGENCE_API_KEY`).

1. **Baseline (no knowledge).** In a fresh thread, ask the agent to approve an
   over-limit transaction. With role #4 framing intact it **fails correctly**:
   it hits the gate, has no procedure, and (per ACTION DISCIPLINE) reports the
   failure instead of firing a distractor. _This failure is the control._
2. **Human teaches.** A human opens the policy-exception modal and performs the
   unlock (justifying code → finalize). Each step fires `recordUserAction(...)`
   on the current thread (now a real stream, not a no-op).
3. **Distill.** The Intelligence writer agent distills those recorded actions
   into a reusable procedure in `/knowledge`.
4. **Fresh agent succeeds unaided.** In a **new** thread (no memory of the
   human's session), ask the same over-limit approval. The agent retrieves
   `/knowledge`, files a _justifying_ exception, finalizes it, and the approval
   now returns **201** — with **no human help and nothing added to the prompt**.

Pass criteria: step 1 fails, step 4 succeeds, and the only thing that changed
between them is the distilled `/knowledge`. That delta _is_ the learning.
