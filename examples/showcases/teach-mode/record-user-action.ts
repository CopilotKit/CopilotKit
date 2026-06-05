/**
 * teach-mode • RECORDING SEAM (role #3 of the 5-role contract)
 * ============================================================
 *
 * This is the canonical, domain-neutral copy of the recording shim used by the
 * teach-mode demos. Copy it verbatim into a new demo's `src/lib/`. It is the
 * ONE primitive you copy once and never edit per-domain — the domain lives
 * entirely in the `UserActionRecord` payloads your UI passes at the call sites,
 * never in this file.
 *
 * WHAT IT IS FOR
 * --------------
 * The self-learning ("teach mode") loop needs demonstrated human actions
 * streamed to the Intelligence "writer" agent so they can be distilled into
 * `/knowledge`. The intended client API for that is a
 * `useRecordUserActionInCurrentThread` hook exported from
 * `@copilotkit/react-core/v2`: a UI component calls it to get a
 * `recordUserAction` function, then calls that function whenever a human
 * mutation lifts a gated capability.
 *
 * THE RECORD SHAPE (identical across every teach-mode demo)
 * ---------------------------------------------------------
 * A component records an action like this:
 *
 *     const recordUserAction = useRecordUserActionInCurrentThread();
 *     // ...after a successful human mutation...
 *     recordUserAction({
 *       title:        "policy_exception.opened",          // machine-ish event name
 *       description:  "Opened a policy exception ...",     // one human sentence
 *       previousData: { approvePermitted: false },         // the GATED capability flags
 *       newData:      { approvePermitted: true /* etc */ }, // the UNLOCKED effect
 *       metadata:     { transactionId },                    // domain ids (the "which")
 *     }).catch(console.error);                              // fire-and-forget; never blocks UI
 *
 * Field conventions (confirmed IDENTICAL in the banking and e-commerce demos —
 * follow them so the distiller sees a uniform stream across demos):
 *
 *   • title        — a machine-ish, dotted event name. The verb is the lifecycle
 *                    step, e.g. `policy_exception.opened`, `policy_exception.finalized`,
 *                    `order.refunded`, `order.return_initiated`,
 *                    `incident_report.opened`, `incident_report.finalized`.
 *   • description  — one plain-English sentence a human could read in a log.
 *   • previousData — the GATED state *before* the action: carry the capability
 *                    flags that were false, e.g. `{ approvePermitted: false }`
 *                    (banking) / `{ refundPermitted: false, returnPermitted: false }`
 *                    (e-commerce). This is what teaches the agent "this was blocked".
 *   • newData      — the UNLOCKED effect *after* the action: the flipped flags and
 *                    the linking ids, e.g. `{ approvePermitted: true,
 *                    transactionActiveExceptionId: exceptionId, exceptionCode }`.
 *                    This is what teaches the agent "...and THIS is what lifted it".
 *   • metadata     — the domain identifiers the action applies to (the "which"),
 *                    e.g. `{ transactionId }` / `{ orderId }`.
 *
 * Why previousData/newData and not just "what happened": the contrast between the
 * gated flags and the unlocked flags is the *signal* the distiller turns into a
 * reusable procedure. Keep the flag names stable across the open→finalize steps
 * so the two records chain into one story.
 *
 * ---------------------------------------------------------------------------
 * CURRENT STATE: THIS IS A NO-OP SHIM (honest backend-block note)
 * ---------------------------------------------------------------------------
 * The OSS `@copilotkit/react-core/v2` build does NOT yet export
 * `useRecordUserActionInCurrentThread`. Its hooks index exports only
 * useFrontendTool / useHumanInTheLoop / useAgent / useThreads / etc. — there is
 * no client-side "record user action" mechanism to call, even when the runtime
 * is wired to a `CopilotKitIntelligence` backend.
 *
 * So this shim exists to keep the call sites real and stable: components import
 * and call `recordUserAction({...}).catch(...)` exactly as they would against the
 * shipped hook, but the call currently records nothing (it only console.debugs in
 * dev). Everything UP TO the recording boundary — the gate, the unlock procedure,
 * the catalogue, the agent framing — works and is verifiable TODAY without any
 * Intelligence backend (see `verify-teachable-gate.sh`). The only thing the no-op
 * defers is the distill → `/knowledge` → fresh-agent-learns leg.
 *
 * The real hook is known to exist in the self-learning react-core at CopilotKit
 * commit `e103a19` (which the Intelligence repo pins). When a react-core build
 * exporting it is one you can depend on, adoption is a ONE-LINE IMPORT SWAP — the
 * call sites do not change.
 *
 * ---------------------------------------------------------------------------
 * THE ONE-LINE SWAP (do this when the real hook ships)
 * ---------------------------------------------------------------------------
 * At each call site (e.g. `policy-exception-modal.tsx`), change ONLY the import:
 *
 *     // before (no-op shim — records nothing):
 *     import { useRecordUserActionInCurrentThread } from "@/lib/record-user-action";
 *
 *     // after (real recording hook — streams to the writer agent on the
 *     // current thread):
 *     import { useRecordUserActionInCurrentThread } from "@copilotkit/react-core/v2";
 *
 * The `UserActionRecord` type and every `recordUserAction({...})` call body stay
 * byte-for-byte the same. The e-commerce demo already imports the hook from
 * `@copilotkit/react-core/v2` directly — the banking demo points at this shim —
 * which is precisely the one-line difference between "backend wired" and
 * "backend pending". (Tip: you can also keep this file and turn it into a
 * re-export — `export { useRecordUserActionInCurrentThread } from
 * "@copilotkit/react-core/v2";` plus the type below — so no call site changes at
 * all.)
 */

/**
 * The record a human-driven UI mutation streams onto the current thread.
 * Domain-neutral by design: all domain specifics live in the values you pass,
 * never in this type.
 */
export type UserActionRecord = {
  /** Machine-ish dotted event name, e.g. `policy_exception.finalized`. */
  title: string;
  /** One human-readable sentence describing what happened. */
  description: string;
  /** Gated state BEFORE the action — carry the capability flags that were false. */
  previousData?: unknown;
  /** Unlocked effect AFTER the action — the flipped flags + linking ids. */
  newData?: unknown;
  /** Domain identifiers the action applies to (the "which"), e.g. `{ orderId }`. */
  metadata?: Record<string, unknown>;
};

/**
 * No-op stand-in for `@copilotkit/react-core/v2`'s
 * `useRecordUserActionInCurrentThread`. Returns a `recordUserAction(record)`
 * function with the same signature as the real hook (returns a Promise so call
 * sites can `.catch(...)`), but records nothing beyond a dev-only console debug.
 *
 * Swap the import for the real hook when it ships — see the file header. The
 * returned function's signature is intentionally identical so no call site changes.
 */
export const useRecordUserActionInCurrentThread =
  () =>
  (record: UserActionRecord): Promise<void> => {
    if (process.env.NODE_ENV !== "production") {
      // Lets you see the would-be stream in the browser console while the
      // backend is pending. Drop or keep — the real hook ignores this.
      console.debug("[teach-mode:record]", record.title, record);
    }
    return Promise.resolve();
  };
