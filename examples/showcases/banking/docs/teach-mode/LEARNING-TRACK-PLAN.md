# Learning-Track Plan — make the teach-mode loop actually learn in the banking demo

> **What this is.** A design doc (not an implementation) for closing the loop on the
> banking teach-mode demo: human demonstrates the over-limit unlock → the demonstration is
> recorded on the thread → distilled into `/knowledge` → a fresh agent performs the unlock
> unaided. Plus the three pieces of teachable-demo UX (suggested prompt, inline HITL,
> recording vignette) that make the loop legible on screen.
>
> **Owner:** jerel@copilotkit.ai · **Date:** 2026-06-05 · **Status:** Draft for review
>
> **Repos in play (read both):**
>
> - **Banking demo (canonical, OSS):** `CopilotKit/examples/showcases/banking` — Next.js App
>   Router, CopilotKit v2 hooks, `workspace:*` packages (react-core 1.59.2, **no recording
>   hook**). This is where the gate/unlock/framing/UX live and verify today.
> - **Intelligence repo (the backend + the real hook):** `cpk-intelligence-banking` —
>   Nx monorepo with `apps/app-api`, `apps/realtime-gateway`, `apps/sl-worker`, and
>   `demos/{e-commerce,banking,…}`. Its root `package.json` pins
>   `@copilotkit/react-core@e103a19` (the build that **exports** the recording hook).
> - **Cookbook contract:** `./README.md` (the 5-role teachable loop) + the recording seam at
>   `../../src/lib/record-user-action.ts` (a no-op shim today) + `./verify-teachable-gate.sh`
>   (the backend-independent REST proof).

---

## 0. TL;DR

The **left half** of the teachable loop (gate → symptom → agent framing → human unlock → a
`recordUserAction(...)` call site) is built and verifiable in the banking demo today. The
**right half** (recording actually streams → distill → `/knowledge` → fresh agent learns)
is gated on two blockers:

- **Blocker 2a — the recording hook.** `useRecordUserActionInCurrentThread` does not exist
  in the OSS `@copilotkit/react-core/v2` build the banking demo currently resolves
  (`workspace:*` → 1.59.2). It exists at CopilotKit commit `e103a19`. Clearing it = pin that
  build + a one-line import swap of the `record-user-action.ts` shim.
- **Blocker 2b — the Intelligence backend.** The runtime route is already env-gated on
  `INTELLIGENCE_API_URL` / `INTELLIGENCE_GATEWAY_WS_URL` / `INTELLIGENCE_API_KEY`. Clearing
  it = stand up the Intelligence stack (`app-api` + `realtime-gateway` + `sl-worker` →
  `/knowledge`) locally or hosted, and point those three env vars at it.

The three teachable-demo UX pieces — **suggested prompt**, **inline HITL tool-call card**,
**pulsating recording vignette** — can be built TODAY against the no-op shim and a local
`recording` flag, because none of them needs the backend to render. They form the
buildable-now track (FOR-148). The live learn/distill/retrieve loop is the blocked track
(FOR-146/147/149). FOR-145 is the fresh-agent verification harness.

Recommended sequencing: **UX shell now (FOR-148)** in parallel with **standing up the
backend (FOR-147)**; then **pin the hook + swap the import (FOR-146)**; then the
**fresh-agent proof (FOR-145/149)** ties it together.

---

## 1. The loop, end to end — concretely, against THIS demo

The banking entities are: `transaction` (the gated write is _approve_), `expense-policy`
(the limit that blocks it), `policy-exception` (the unlock record), and a
`policy-exception-code` catalogue (justifying vs decoy vs invalid).

| Step                                           | What happens                                                                                                                                                                                                                                                                                                            | THIS demo's concrete entities + file                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Agent A tries the obvious write**         | A fresh agent is asked to approve an over-limit transaction. It calls the approve write.                                                                                                                                                                                                                                | The agent prompt in `src/app/api/copilotkit/[[...slug]]/route.ts` (`bankingAgent`) lists the tools but withholds the unlock recipe. The approve path is the `showAndApproveTransactions` HITL in `src/app/page.tsx` → `changeTransactionStatus` (`src/app/actions.ts`) → `PUT /api/v1/transactions/[id]`.                                                                                                                                                                     |
| **2. Gate fails, symptom-only**                | The PUT returns **422 `OVER_POLICY_LIMIT`**, message `"<policy> policy limit exceeded"`. It names the _problem_ (over limit), never the _fix_ (policy exception).                                                                                                                                                       | `src/app/api/v1/transactions/[id]/route.ts` (the `patch.status === "approved" && !isWithinPolicyLimit && !hasApprovedException` branch). Rules in `src/lib/store.ts`: `isWithinPolicyLimit` / `hasApprovedException` / `canApprove`. Seed: `t-1` (Google Ads, −5000, Marketing limit 5000/spent 500) ⇒ over limit.                                                                                                                                                            |
| **3. Agent stops (framing holds)**             | Per the **ACTION DISCIPLINE** clause, the agent does not improvise. It reports the failure and asks the human how to proceed. It does NOT fire a distractor (`sendSpendAlert` / `requestCardReplacement` / `flagForReview`).                                                                                            | Prompt + distractor tools in the runtime route and `src/app/page.tsx` (the three `useFrontendTool` no-op distractors). This is the **control**: pre-learning, a correctly-framed agent cannot pass.                                                                                                                                                                                                                                                                           |
| **4. Human demonstrates the unlock**           | A human opens a policy exception under a **justifying** code (e.g. `EXC-BOARD-APPROVED`), finalizes it (auto-approves + links `activeExceptionId`), then re-approves — now **201**.                                                                                                                                     | Today: `PolicyExceptionModal` (`src/components/policy-exception-modal.tsx`) opened from the over-limit row in `src/components/transactions-list.tsx`. Catalogue: `src/app/api/v1/policy-exception-codes.ts` (`JUSTIFYING_EXCEPTION_CODES` = BOARD-APPROVED / CONTRACTUAL-COMMITMENT / EMERGENCY-SPEND; decoys = WILL-REIMBURSE / ONE-TIME). REST: `exceptions/route.ts` + `exceptions/[id]/finalize/route.ts`. **This plan moves that flow inline into the chat — see §3.2.** |
| **5. Each mutation is recorded on the thread** | After `open()` and after `finalize()`, the UI calls `recordUserAction({title, description, previousData, newData, metadata})`. `previousData` carries the gated flags (`approvePermitted: false`); `newData` the unlocked effect (flipped flags + the linking exception id); `metadata` the `transactionId`.            | Two existing calls in `policy-exception-modal.tsx` (`policy_exception.opened`, `policy_exception.finalized`) + two in `transactions-list.tsx` (`transaction.approved`, `transaction.denied`). The import is the no-op shim `@/lib/record-user-action` **today** — see Blocker 2a.                                                                                                                                                                                             |
| **6. Events stream to the gateway**            | With the real hook + Intelligence runtime, every AG-UI event of the run (including the recorded user actions) streams over the Phoenix WebSocket to the Intelligence gateway, scoped to the current user + thread.                                                                                                      | The env-gated `CopilotKitIntelligence({apiUrl,wsUrl,apiKey})` branch of `createRuntime()` in the runtime route; `identifyUser` maps `properties.userRole` → a stable `northwind-<role>` id so threads + knowledge are scoped consistently. Reference: `cpk-intelligence-banking/demos/e-commerce/bff/.../main.ts`.                                                                                                                                                            |
| **7. Distilled into `/knowledge`**             | The `sl-worker` sweeps the recorded actions and an LLM writer distills a reusable procedure: _"to approve an over-policy-limit transaction, open a policy exception under a justifying code (board-approved / contractual / emergency), finalize it, then approve."_ It lands in `/knowledge` (shared per org+project). | `apps/sl-worker` in the Intelligence repo (gated on `SL_ENABLED=true`); writes `cpki.knowledge_base_files` exposed to agents as `/knowledge`.                                                                                                                                                                                                                                                                                                                                 |
| **8. Agent B (fresh) learns + succeeds**       | In a NEW thread with no memory of the human, the agent is asked the same over-limit approval. It greps `/knowledge` (via the `copilotkit_knowledge_base_shell` tool), discovers the procedure, files a _justifying_ exception, finalizes it, approves → **201** — no human help, nothing added to the prompt.           | Same `bankingAgent` prompt (still recipe-free) reading `/knowledge`. This is the **proof of learning** — see §5.                                                                                                                                                                                                                                                                                                                                                              |

The contrast in step 5 (`previousData` gated flags vs `newData` unlocked flags) is the signal
the distiller turns into the procedure — which is why the flag names must stay stable across
`open → finalize`. This invariant is already honored in both call sites; do not break it.

---

## 2. The two blockers + how to clear them, in order

### 2a. The recording hook (FOR-146) — pin the build, swap one import

**Current state (verified).**

- Banking demo `package.json` pins CopilotKit packages as `workspace:*`; the installed
  `@copilotkit/react-core` is **1.59.2**, whose `v2` hooks index exports
  `useFrontendTool` / `useHumanInTheLoop` / `useAgent` / `useThreads` / `useComponent` /
  `useConfigureSuggestions` — but **not** `useRecordUserActionInCurrentThread`
  (`grep` of `node_modules/@copilotkit/react-core/dist/v2/` returns nothing).
- So all four call sites import the **no-op shim** at `src/lib/record-user-action.ts`. The
  shim returns a `recordUserAction` that only `console.debug`s in dev and resolves — it
  records nothing. The call-site bodies are already byte-for-byte what the real hook expects.
- The Intelligence repo's root `package.json` pins the hook-bearing build:
  `"@copilotkit/react-core": "https://pkg.pr.new/CopilotKit/CopilotKit/@copilotkit/react-core@e103a19"`
  (and the matching `core` / `runtime` / `shared` / `sdk-js` at `e103a19`). The e-commerce
  demo there imports `useRecordUserActionInCurrentThread` directly from
  `@copilotkit/react-core/v2` and it resolves — proving `e103a19` exports it.

**The unblock, exactly.**

1. **Land/pin a react-core build that exports the hook.** Two options:
   - **(A) Pin the published pkg.pr.new build** (matches the Intelligence repo). In the
     banking demo `package.json`, replace the four `workspace:*` CopilotKit entries with the
     `e103a19` pins (at minimum `@copilotkit/react-core`, plus `@copilotkit/core`,
     `@copilotkit/runtime`, `@copilotkit/shared` to keep the runtime route's
     `CopilotKitIntelligence` / `BuiltInAgent` imports on the same line). Re-install.
     _Cost:_ the demo leaves the OSS monorepo `workspace:*` graph; lockfile churn. Best when
     the demo is being **vendored into the Intelligence repo** (where these pins already
     exist — see §6).
   - **(B) Land the recording hook into the OSS `react-core/v2` build** the demo's
     `workspace:*` already resolves, then bump. _Cost:_ a real OSS change; out of scope for
     this demo plan but the cleaner long-term home. Treat as a CopilotKit-core ticket.
2. **The one-line import swap** at each of the **four** call sites. Change ONLY the import;
   every `recordUserAction({...})` body and the `UserActionRecord` type stay identical:

   ```ts
   // before — no-op shim (banking today):
   import { useRecordUserActionInCurrentThread } from "@/lib/record-user-action";
   // after — real hook (e-commerce already does this):
   import { useRecordUserActionInCurrentThread } from "@copilotkit/react-core/v2";
   ```

   Call sites to edit: `src/components/policy-exception-modal.tsx` (line 10),
   `src/components/transactions-list.tsx` (line 15) — plus the two inline-HITL components this
   plan introduces in §3.2 (which inherit the same import). **Recommended variant:** instead
   of editing imports, turn the shim into a **re-export** so zero call sites change:

   ```ts
   // src/lib/record-user-action.ts (after the hook ships):
   export { useRecordUserActionInCurrentThread } from "@copilotkit/react-core/v2";
   export type { UserActionRecord } from "@copilotkit/react-core/v2"; // if the type is exported there
   ```

   This is the smallest possible diff and keeps the "copy this file verbatim" cookbook story
   intact.

**Definition of done for 2a:** the real hook resolves; `recordUserAction(...)` calls stream
to the runtime instead of `console.debug`; no call-site body changed.

### 2b. The Intelligence backend (FOR-147) — stand up record→distill→`/knowledge`

**Current state (verified).** The runtime route already env-gates the backend:

```ts
const intelligenceEnabled = Boolean(
  INTELLIGENCE_API_URL && INTELLIGENCE_GATEWAY_WS_URL && INTELLIGENCE_API_KEY,
);
// enabled → new CopilotRuntime({ agents:{default:bankingAgent}, intelligence, identifyUser })
// missing → new CopilotRuntime({ agents:{default:bankingAgent}, runner: new InMemoryAgentRunner() })
```

So no route code changes to _turn on_ the backend — it is purely a deploy + env exercise.
What each var points at:

| Env var                       | Points at                                                                                          | Local-dev value                                                                                      | Notes                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTELLIGENCE_API_URL`        | `apps/app-api` HTTP — the `/knowledge` + threads + user_actions store                              | `http://localhost:7050` (`APP_API_PORT` default in `scripts/local-dev.sh`)                           | The durable backend the gateway writes to and `/knowledge` is read from.                                                                        |
| `INTELLIGENCE_GATEWAY_WS_URL` | `apps/realtime-gateway` Phoenix WebSocket — where AG-UI run events (incl. recorded actions) stream | `ws://localhost:7053` (`REALTIME_GATEWAY_PORT` default)                                              | The live ingestion seam.                                                                                                                        |
| `INTELLIGENCE_API_KEY`        | the org/project key (scopes threads + `/knowledge`)                                                | the seeded `cpk_…` key for `casa-de-erlang` (e-commerce uses `cpk_sPRVSEED_seed0privat0longtoken00`) | Must belong to an org whose `cpki.users` includes the demo identities `identifyUser` mints (`northwind-<role>`), or those users must be seeded. |
| `COPILOTKIT_LICENSE_TOKEN`    | optional, read automatically by the runtime                                                        | —                                                                                                    | Only if the build requires it.                                                                                                                  |
| `SL_ENABLED`                  | gate on the **`sl-worker`** distillation sweep (Intelligence side)                                 | `true`                                                                                               | Without it the worker won't distill — recording streams but `/knowledge` never fills.                                                           |

**Standing it up — two paths.**

- **Local-dev (recommended for building the proof).** The Intelligence repo's
  `scripts/local-dev.sh` already boots the whole stack with `pnpm nx serve`:
  `app-api` (`:7050`), `realtime-gateway` (`:7053`), the per-demo BFFs, and — when
  `SL_ENABLED=true` — the `sl-worker` on a heartbeat. It **already registers a `banking`
  demo (demo 6: BFF `:7071`, web `:7072`)** alongside e-commerce. So the realistic path to a
  live banking loop is to run the demo **inside the Intelligence repo** (where the `e103a19`
  pins and the SL services already exist), not to point the standalone Next.js app at a
  hand-rolled stack. See §6 for that recommendation. If you keep the standalone Next.js app,
  set the three env vars to the local-dev URLs/key above and run `scripts/local-dev.sh` in the
  Intelligence repo to provide the backend.
- **Hosted.** Point the three vars at a deployed Intelligence environment (app-api URL,
  gateway WSS URL, a real `cpk_…` key) — e.g. a Railway/staging deploy of the Intelligence
  apps. Same route code; only env differs. Ensure `SL_ENABLED=true` on that environment's
  `sl-worker` and that the key's org has the demo users seeded.

**Definition of done for 2b:** with 2a also done, a recorded human unlock results in a
distilled procedure appearing in `/knowledge` (verifiable by grepping `/knowledge` via the
agent or inspecting `cpki.knowledge_base_files`).

**Ordering.** 2a and 2b are independent to _build_ but both required for the live loop. Do
2b's standup in parallel with the UX shell; 2a is the final flip. The cleanest single move is
§6 (vendor into the Intelligence repo), which clears 2a and 2b together because the pins and
services already live there.

---

## 3. The teachable-demo UX (first-class — explicit feedback)

These three make the loop legible. **All three are buildable today** against the no-op shim
and a local `recording` flag (§4). Map below is to real files in
`CopilotKit/examples/showcases/banking`.

### 3.1 Suggested prompt — a starter pill that kicks off the teachable scenario

**Goal.** The first thing a viewer sees offers a one-click path straight into the over-limit
gate, so the "agent fails → human teaches → agent learns" arc starts without anyone having to
know the domain.

**Where it plugs in.** `src/app/wrapper.tsx` already registers welcome-screen pills via
`useConfigureSuggestions` (the v2 way — there is no `suggestions` prop on the v2 chat
component). The `BankingSuggestions()` component calls it with
`available: "before-first-message"` and three pills today.

**The change.** Add the teachable pill as the **first** suggestion so it leads. Exact copy:

```ts
useConfigureSuggestions({
  available: "before-first-message",
  suggestions: [
    {
      title: "Approve the $5,000 Marketing transaction",
      message:
        "Approve the $5,000 Google Ads transaction on the Marketing policy.",
    },
    { title: "View transactions", message: "Show me my recent transactions" },
    { title: "Add a card", message: "Add a new credit card" },
    {
      title: "Assign a policy",
      message: "Assign a spending policy to one of my cards",
    },
  ],
});
```

- The `message` deliberately matches seed `t-1` (Google Ads, −$5,000, Marketing policy, limit
  $5,000 / spent $500), so approving it hits `OVER_POLICY_LIMIT` — the gate — every time.
- Keep `title` human and benign ("Approve the $5,000 Marketing transaction"); it must **not**
  hint at the exception path (same symptom-only spirit as the gate).
- Pre-learning the agent will fail this correctly (control). Post-learning it will succeed.
  The same pill demonstrates both halves of the arc.

**Touch-points:** `src/app/wrapper.tsx` (`BankingSuggestions`). No other file.

### 3.2 Inline HITL — approve/deny + file-exception rendered IN the chat

**Goal.** The human's whole demonstration — see the over-limit symptom, approve/deny, and
_file a policy exception_ — happens **inline in the chat as a tool-call card**, not in a
separate page modal. That's what makes the recorded demonstration feel like "the agent
watched me do it right here."

**What exists today.**

- The approve/deny inline card is **already** an inline HITL: `showAndApproveTransactions`
  (`src/app/page.tsx`, ~line 405) renders `<TransactionsList showApprovalInterface>` inside
  the chat via `useHumanInTheLoop`'s `render`. That list shows the **over-limit symptom**
  ("Over policy limit" badge) and a **"File policy exception"** button — but that button
  currently opens a **separate page modal** (`PolicyExceptionModal` mounted at the bottom of
  `transactions-list.tsx`, a shadcn `Dialog`). That modal is the one piece that breaks the
  "inline" story.
- The standalone approve/deny buttons (`src/components/approval-buttons.tsx`) are a shared
  primitive reused across every HITL card.

**The design.**

1. **New inline component `PolicyExceptionInline`** (`src/components/policy-exception-inline.tsx`),
   modeled on `PolicyExceptionModal` but rendered as a chat card (no `Dialog` chrome — the
   same rounded `bg-surface` card the other HITL renders use). It shows:
   - the **symptom** ("This transaction is over its Marketing policy limit"),
   - the **code picker** (the existing `POLICY_EXCEPTION_CODES` select — labels for humans,
     codes persisted),
   - **File exception** (calls `openPolicyException` → `finalizePolicyException`, the same
     REST callers threaded from `useCreditCards` in `actions.ts`),
   - and on success a confirmation + the approve affordance.
     It carries the **same two `recordUserAction` calls** (`policy_exception.opened` →
     `policy_exception.finalized`) verbatim from the modal — the recording payloads do not
     change.
2. **A new inline HITL tool `fileAndApproveOverLimit`** (a `useHumanInTheLoop` in
   `src/app/page.tsx`) whose `render` mounts `PolicyExceptionInline`. Description stays
   **neutral** (does not name the exception path or which codes justify — preserves the
   learning invariant), e.g. _"Resolve a blocked over-limit approval. Requires human
   approval."_ This becomes the inline surface the human uses to teach, and later the surface
   the learned agent's `openPolicyException` / `finalizePolicyException` calls render into.
3. **Reuse vs replace.**
   - **Reuse** `approval-buttons.tsx` unchanged for approve/deny.
   - **Reuse** the existing `openPolicyException` / `finalizePolicyException` HITL tools
     (`src/app/page.tsx`, ~lines 492 / 549) — they already render inline approve cards; the
     learned agent drives the unlock through these. `PolicyExceptionInline` is the
     _human-initiated_ twin.
   - **Replace** the page-modal entrypoint: drop the `setExceptionTxnId` → `<PolicyExceptionModal>`
     branch in `transactions-list.tsx` in favor of rendering `PolicyExceptionInline` within the
     chat card. Keep `policy-exception-modal.tsx` only if a non-chat entry is still wanted;
     otherwise retire it (its recording payloads move into the inline component).

**Touch-points:** new `src/components/policy-exception-inline.tsx`; new HITL tool +
`render` in `src/app/page.tsx`; edits to `src/components/transactions-list.tsx` (swap the
modal mount for the inline card); reuse `src/components/approval-buttons.tsx`. Reference shape:
`cpk-intelligence-banking/demos/e-commerce/.../incident-create-modal.tsx` (same
open→record→finalize→record pattern).

### 3.3 Pulsating "recording" vignette — a violet edge glow while recording

**Goal.** While the agent is recording the human's demonstrated actions, a soft pulsating
violet glow/vignette hugs the **canvas edges**, signaling "the agent is watching and recording
this for future reference." It turns off when recording ends.

**Trigger / state.** Introduce a tiny **recording context** (`src/components/recording-context.tsx`)
exposing `isRecording` + `beginRecording()` / `endRecording()` (or a ref-counted
`withRecording()` wrapper). Wire it around the **`recordUserAction` calls**: each call site
calls `beginRecording()` immediately before firing the record(s) and `endRecording()` when the
demonstration step settles. Concretely:

- In `PolicyExceptionInline` (§3.2): `beginRecording()` at the start of `handleSubmit`, and
  `endRecording()` after the second (`finalized`) record resolves (or in `finally`).
- In `transactions-list.tsx` approve/deny: wrap the `recordUserAction(...)` call the same way.
- Use a small **debounce/min-duration** (e.g. keep it on ≥1200ms) so a fast fire-and-forget
  record still produces a visible pulse, and **ref-count** so overlapping records (open +
  finalize) don't flicker it off between steps.

> This flag is **independent of the backend**: it reflects "the UI is emitting a record right
> now," which is true even against the no-op shim. So the vignette is fully demoable today
> (FOR-148) and stays correct once the real hook streams (FOR-146).

**Visual treatment.**

- An **edge vignette**: a full-viewport overlay with `box-shadow: inset 0 0 0 …` /
  `radial-gradient` mask so color concentrates at the **edges** and fades to transparent in the
  center (content stays unobscured).
- **On-brand violet:** use the existing tokens — `--brand-violet` (`hsl(252 83% 67%)`) /
  `--brand-indigo` (`hsl(248 84% 60%)`) and the `--shadow-glow` feel
  (`0 12px 30px hsl(252 83% 60% / 0.35)`). Keep alpha low (~0.25–0.4) so it reads as a glow,
  not a wash.
- **Pulse animation:** a 2–3s `@keyframes` easing opacity/blur between two low values
  (e.g. 0.25 ↔ 0.45), `ease-in-out`, infinite while recording. Fade in/out over ~200ms on
  enter/leave so it doesn't snap.
- **Non-blocking:** `position: fixed; inset: 0; pointer-events: none; z-index` above content
  but below modals/toasts. It must never intercept clicks.
- **Reduced motion:** under `@media (prefers-reduced-motion: reduce)`, drop the pulse — show a
  **static** low-opacity violet edge glow instead (still communicates "recording", no
  animation).

**Where it mounts.** A top-level overlay so it frames the whole canvas. Mount
`<RecordingVignette />` inside `CopilotKitWrapper` in `src/app/wrapper.tsx` (a sibling of
`LayoutComponent` / `ChatPanel`, both inside the provider tree so it can read the recording
context). The `RecordingProvider` wraps the same subtree. Add the keyframes + `.recording-vignette`
styles to `src/app/globals.css` (which already owns the brand tokens and `.brand-gradient`).

**How it turns off.** When `endRecording()` drops the ref-count to zero (after the min-duration
elapses), `isRecording` flips false; the overlay fades out over ~200ms and the animation stops.

**Touch-points:** new `src/components/recording-context.tsx`; new `src/components/recording-vignette.tsx`;
keyframes/classes in `src/app/globals.css`; mount + provider in `src/app/wrapper.tsx`; `begin/endRecording`
wrapping in `policy-exception-inline.tsx` and `transactions-list.tsx`.

---

## 4. Buildable NOW vs blocked — the explicit split

| Piece                                             | Ticket  | Needs the real hook?                                                               | Needs the Intelligence backend?                                | Buildable today?                                              |
| ------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Suggested prompt (§3.1)                           | FOR-148 | No                                                                                 | No                                                             | **Yes** — pure `useConfigureSuggestions` copy.                |
| Inline HITL card (§3.2)                           | FOR-148 | No (renders the demonstration UI; recording payloads already present via the shim) | No                                                             | **Yes** — renders + drives REST unlock; records via the shim. |
| Recording vignette (§3.3)                         | FOR-148 | No (reads a local `recording` flag set around the record calls)                    | No                                                             | **Yes** — flag is true even against the no-op shim.           |
| Recording actually streams (role #3 beyond no-op) | FOR-146 | **Yes** (pin `e103a19` + import swap)                                              | Indirectly (events have somewhere to go)                       | No — blocked on 2a.                                           |
| Distill → `/knowledge` (role #5)                  | FOR-147 | —                                                                                  | **Yes** (`app-api` + gateway + `sl-worker`, `SL_ENABLED=true`) | No — blocked on 2b.                                           |
| Fresh-agent learns + succeeds                     | FOR-149 | Yes                                                                                | Yes                                                            | No — needs 2a + 2b.                                           |
| Fresh-agent verification harness                  | FOR-145 | The script half works today (§5); the learning half needs 2a+2b                    | Partial                                                        | The REST proof: **yes**. The learning proof: blocked.         |

**Why the UX is safe to build first.** The three UX pieces only depend on (a) the v2 chat +
HITL APIs the demo already uses, and (b) a local `recording` boolean. The no-op shim already
keeps the `recordUserAction` call sites real and stable, so wrapping them in `begin/endRecording`
and rendering inline cards is wiring that does not change when the real hook lands — at that
point the same calls simply also stream. **No rework.**

### Recommended sequencing

1. **FOR-148 — UX shell (now, parallelizable).** Suggested prompt → inline HITL card →
   recording vignette. Verifiable visually + via `verify-teachable-gate.sh` (the REST contract
   is unaffected). Ship this regardless of backend timing — it makes the demo legible today.
2. **FOR-147 — backend standup (now, parallel to FOR-148).** Bring up `app-api` + gateway +
   `sl-worker` (local-dev or hosted) and confirm the three env vars + `SL_ENABLED`. No demo
   code changes (the route is already gated).
3. **FOR-146 — pin the hook + swap the import (after 147 so streaming has a destination).**
   Pin `e103a19` (or re-export shim) → recorded actions now stream.
4. **FOR-149 / FOR-145 — fresh-agent proof.** With 146+147 live, run the learning proof (§5)
   and codify it in a harness.

**Strong recommendation (§6):** do FOR-146 + FOR-147 by **vendoring the demo into the
Intelligence repo**, where both the `e103a19` pins and the SL services already exist — that
collapses 2a+2b into "run the existing local-dev with the banking demo wired like e-commerce."

---

## 5. Verification strategy — proving learning, not scripting

### 5.1 Backend-independent REST proof (works TODAY) — roles #1 + #2 — FOR-145 (lower half)

`verify-teachable-gate.sh` already drives the real REST routes against a running banking dev
server and asserts the full gate→unlock contract. Run it (point `BASE_URL` at the served port):

```bash
BASE_URL=http://localhost:3000 ./verify-teachable-gate.sh   # next dev defaults to :3000
```

It asserts, in order:

- **A. GATE** — `PUT /api/v1/transactions/t-1 {"status":"approved"}` → **422
  `OVER_POLICY_LIMIT`**, and the body does **not** mention the exception/unlock path
  (symptom-only invariant).
- **B. UNLOCK** — open `EXC-BOARD-APPROVED` on `t-1` → **201** → finalize → **200 approved** →
  re-approve `t-1` → **201** (gate lifted by a justifying code).
- **C. DECOY** — `EXC-WILL-REIMBURSE` on `t-3` files + finalizes (**201/200**) but the approve
  stays **422** (decoy does not justify).
- **D. CATALOGUE** — an invalid code → **422 `INVALID_EXCEPTION_CODE`**, body does **not**
  enumerate the catalogue (non-enumeration invariant).

This proves the gate is real and the unlock is discriminating — i.e. there is genuinely
_something to learn_ — without any Intelligence backend. It is the control that the demo isn't
faked. Re-run from a fresh server to reseed (in-memory store).

### 5.2 The fresh-agent proof (activates after 2a + 2b) — roles #3 + #5 — FOR-149

This is the proof the loop **learned**, not that REST works. Requires the real hook (2a) and
the env-gated `CopilotKitIntelligence` backend with `SL_ENABLED=true` (2b).

1. **Baseline (control).** Fresh thread, ask: _"Approve the $5,000 Google Ads transaction on
   the Marketing policy."_ With the recipe-free prompt + ACTION DISCIPLINE intact, the agent
   hits the gate, has no procedure, and **reports the failure** instead of firing a distractor.
   _This failure is the control — record it._
2. **Human teaches.** Open the inline policy-exception card (§3.2), pick a **justifying** code,
   file + finalize. Each step fires `recordUserAction(...)` on the current thread — now a real
   stream (2a), and the vignette (§3.3) confirms recording is live on screen.
3. **Distill.** The `sl-worker` (2b, `SL_ENABLED=true`) distills the recorded actions into a
   reusable procedure in `/knowledge`. _Spot-check:_ grep `/knowledge` (via the agent or
   `cpki.knowledge_base_files`) and confirm the over-limit/policy-exception procedure exists.
4. **Fresh agent succeeds unaided.** A **new** thread (and ideally a different seeded user, to
   prove cross-thread/cross-user transfer), same approval request. The agent greps `/knowledge`,
   files a _justifying_ exception, finalizes, approves → **201** — **no human help, nothing
   added to the prompt.**

**Pass criteria:** step 1 fails, step 4 succeeds, and the **only** thing that changed between
them is the distilled `/knowledge`. That delta is the learning. Codify as the FOR-145 harness:
the REST proof (§5.1) gates "is there something to learn," the fresh-agent run gates "did it
learn it."

**Anti-cheat checks (keep the proof honest):**

- The agent prompt at step 4 is **byte-identical** to step 1 (recipe still withheld — diff the
  runtime route prompt).
- A run that files a **decoy** code must still fail (the agent must learn _which_ codes justify,
  not just "file an exception").
- Distractor tools must remain harmless no-ops (a "success" from `sendSpendAlert` must not be
  mistaken for clearing the gate).

---

## 6. Recommended path: vendor into the Intelligence repo (clears 2a + 2b together)

The standalone Next.js banking demo can _render_ the full UX today, but the **live learning
loop's natural home is the Intelligence repo**, because:

- it already pins `@copilotkit/react-core@e103a19` (the hook-bearing build) — **2a is free
  there**;
- it already runs `app-api` + `realtime-gateway` + `sl-worker` via `scripts/local-dev.sh`, and
  already registers a **`banking` demo (demo 6)** beside e-commerce — **2b is free there**;
- the e-commerce demo there is a working reference for the exact wiring: `BuiltInAgent` +
  `CopilotKitIntelligence` in the BFF, `identifyUser` from a user header, domain tools in the
  browser via `useFrontendTool`, and the **real** `useRecordUserActionInCurrentThread` import.

This aligns with the existing vendor plan
(`docs/superpowers/plans/2026-06-02-vendor-canonical-saas-demo-sl-threads.md`): port the
banking React surface (pages, the inline HITL card, the vignette, suggestions) into
`demos/banking/react`, keep the prompt + Intelligence wiring in `demos/banking/bff`, and the
two blockers dissolve into "run the local-dev that's already there." The standalone Next.js
app remains the OSS-verifiable artifact for roles #1/#2/#4 + the UX shell; the Intelligence
copy is where roles #3/#5 actually run.

If vendoring is deferred, the standalone demo can still close the loop by (A) pinning `e103a19`
in its own `package.json` and (B) pointing its three env vars at an Intelligence backend
(local-dev in the Intelligence repo, or hosted) — but that hand-wires what the vendor path
gives for free.

---

## 7. File / component touch-point summary

**Edit (UX shell, FOR-148 — buildable now):**

- `src/app/wrapper.tsx` — add the teachable suggestion pill (§3.1); mount `RecordingProvider`
  - `<RecordingVignette />` (§3.3).
- `src/app/page.tsx` — add the `fileAndApproveOverLimit` inline HITL tool whose `render` mounts
  `PolicyExceptionInline` (§3.2).
- `src/components/transactions-list.tsx` — swap the page-modal entry for the inline card; wrap
  the approve/deny `recordUserAction` calls in `begin/endRecording` (§3.2, §3.3).
- `src/app/globals.css` — `.recording-vignette` + `@keyframes` + reduced-motion variant (§3.3).

**Create (UX shell, FOR-148):**

- `src/components/policy-exception-inline.tsx` — inline version of the file-exception flow
  (carries the two existing recording payloads verbatim).
- `src/components/recording-context.tsx` — `isRecording` + `begin/endRecording` (ref-counted,
  min-duration).
- `src/components/recording-vignette.tsx` — the edge-glow overlay.

**Edit (unblock the loop):**

- `package.json` — pin `@copilotkit/react-core` (+ core/runtime/shared) to `e103a19` (FOR-146,
  option A) — or do this via vendoring (§6).
- `src/lib/record-user-action.ts` — turn into a re-export of the real hook (FOR-146) so no call
  site changes.
- **Env only (no code):** set `INTELLIGENCE_API_URL` / `INTELLIGENCE_GATEWAY_WS_URL` /
  `INTELLIGENCE_API_KEY` (+ backend `SL_ENABLED=true`) (FOR-147). The runtime route
  (`src/app/api/copilotkit/[[...slug]]/route.ts`) already branches on these.

**Reuse unchanged:** `src/components/approval-buttons.tsx`; the existing `openPolicyException`
/ `finalizePolicyException` HITL tools in `page.tsx`; the gate route; the catalogue; `store.ts`;
`verify-teachable-gate.sh`.

**Reference (read-only):** `cpk-intelligence-banking/demos/e-commerce/{bff/.../main.ts,
react/.../order-actions-bar.tsx, react/.../incident-create-modal.tsx}` and
`scripts/local-dev.sh`.

---

## 8. Risks / open questions

- **Hook parity at `e103a19`.** Confirm the published `react-core@e103a19` `v2` index exports
  `useRecordUserActionInCurrentThread` _and_ the `UserActionRecord` type (e-commerce imports the
  hook; verify the type export before relying on it in the re-export shim — otherwise keep the
  local type).
- **Pin drift vs `workspace:*`.** Pinning the demo to `e103a19` takes it off the OSS monorepo
  graph; the runtime route imports `CopilotKitIntelligence` / `BuiltInAgent` from
  `@copilotkit/runtime/v2`, so pin runtime to the same commit to avoid a split-brain build.
  Vendoring (§6) sidesteps this.
- **Identity scoping.** `identifyUser` mints `northwind-<role>`; the `INTELLIGENCE_API_KEY`'s
  org must have those users seeded (e-commerce seeds four users in `casa-de-erlang`). Mismatch
  = threads/knowledge land under an unexpected scope and the fresh-agent retrieval misses.
- **Writer non-determinism.** The LLM distiller may phrase `/knowledge` differently run to run;
  keep a deterministic fallback note for scripted live demos, and assert on _behavior_ (the 201) not on the knowledge text.
- **Vignette over modals.** Ensure the overlay's `z-index` sits above page content but **below**
  HITL cards/toasts, and `pointer-events: none` everywhere, so it never blocks the approve
  buttons the human needs during recording.
- **Inline modal retirement.** Decide whether to fully retire `policy-exception-modal.tsx` or
  keep it as a non-chat entry; if retired, ensure its recording payloads are preserved exactly
  in `policy-exception-inline.tsx` (the distiller depends on the stable flag names).

---

## 9. Ticket map (suggested)

| Ticket      | Scope                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **FOR-145** | Verification harness: REST gate proof (works today) + fresh-agent learning proof (activates post-146/147).                          |
| **FOR-146** | Recording hook unblock: pin `e103a19` (or re-export shim) + one-line import swap.                                                   |
| **FOR-147** | Intelligence backend standup: `app-api` + gateway + `sl-worker` (`SL_ENABLED=true`); wire the three env vars (local-dev or hosted). |
| **FOR-148** | Teachable-demo UX shell (buildable now): suggested prompt + inline HITL card + recording vignette.                                  |
| **FOR-149** | Close the loop: with 146+147 live, demonstrate fresh-agent success unaided and capture it in the harness.                           |
