import { describeError, settleInterrupt, staleNote } from "./settle";
import type { RespondFn } from "./settle";
import type { ReturnRequest } from "./data/types";

/**
 * The one sentence a SUCCESSFUL refund settles with — nothing else in this skin
 * may produce it, and `readRefundedCustomer` below is the only thing that reads
 * it. `staleNote` may follow it; no figure ever does (rule 4 in `tools.tsx`).
 */
const refundIssuedLine = (customerName: string) =>
  `Refund issued on ${customerName}'s return.`;

/**
 * The customer name the settled result REPORTS, or `null` when the result is not
 * a success line at all (a cancel, or a refusal sentence).
 *
 * On thread replay this string is the only surviving record of the refund — the
 * `answeredRefunds` map is live-session state — so the card must recover the name
 * from it. That is exactly why the two halves live together here: the reader used
 * to be an END-ANCHORED regex inside the card, which stopped matching the moment
 * `submitRefund` began appending `STALE_VIEW_NOTE`, and a refund that had really
 * been issued replayed as a NEGATIVE receipt printing the raw sentence.
 */
export function readRefundedCustomer(settled: string): string | null {
  return /^Refund issued on (.+?)'s return\./.exec(settled.trim())?.[1] ?? null;
}

/**
 * BEAT 3a's write, lifted out of `tools.tsx`'s render closure.
 *
 * Every other tool in this skin inlines its own fetch; this one does not, and the
 * reason is worth the inconsistency. This handler is what GUARANTEES the refund
 * interrupt gets settled — on success, on a refusal, and on a fetch that never
 * completed — and a guarantee buried in a JSX prop cannot be tested. Here it can:
 * see `refund.test.ts`.
 *
 * Total by construction: every path ends in a `settleInterrupt`, and it never
 * throws. That is what lets `RefundCard` treat a throw from its handler as
 * impossible and keep its "Issuing…" button honest.
 */
export async function submitRefund({
  request,
  amount,
  respond,
  refresh,
  onIssued,
}: {
  request: Pick<ReturnRequest, "id" | "customerName">;
  amount: number;
  respond: RespondFn | undefined;
  /**
   * Re-reads the ledger so the page catches up. Contracted not to reject;
   * resolves `false` when the re-read did not land, which is appended to the
   * receipt as `staleNote` rather than reported as a failed refund.
   */
  refresh: () => Promise<boolean>;
  /**
   * Record the replay memory for this call. Invoked ONLY once the interrupt has
   * really been settled as a success — written any earlier, a failed handoff
   * would leave the map claiming an answered call the run is still waiting on.
   */
  onIssued: () => void;
}): Promise<string | null> {
  let issued = false;
  // Assume the worst until a re-read actually lands, so every path that skips
  // the refresh (or whose refresh throws) reports the screen as behind rather
  // than silently claiming it is current.
  let refreshed = false;
  try {
    const res = await fetch(`/api/commerce/v1/returns/${request.id}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return await settleInterrupt(
        respond,
        `Could not refund ${request.customerName}: ${body?.message ?? res.status}`,
      );
    }
    issued = true;
    refreshed = await refresh();
  } catch (error) {
    if (!issued) {
      // Offline, or the dev server restarted mid-click. The refund did not
      // happen — say so, and settle, because an unsettled interrupt does not
      // just look broken, it wedges the run.
      return await settleInterrupt(
        respond,
        `Could not refund ${request.customerName}: ${describeError(error)}`,
      );
    }
    // The money moved and only the on-screen ledger refresh failed. Reporting
    // failure here would be a receipt for a write that DID happen — the mirror
    // image of the replay bug called out in `tools.tsx`, and just as bad. Fall
    // through to the success line.
    console.error(
      "[commerce] refund landed but the ledger refresh failed",
      error,
    );
  }
  // The ONLY thing the assistant ever learns. No figure, by design — plus, when
  // the ledger re-read did not land, the fact that the screen is behind. Saying
  // so is NOT reporting a failed refund: the money moved either way, and this is
  // the one note that distinguishes "done, screen is stale" from "done".
  const failure = await settleInterrupt(
    respond,
    refundIssuedLine(request.customerName) + staleNote(refreshed),
  );
  if (!failure) onIssued();
  return failure;
}
