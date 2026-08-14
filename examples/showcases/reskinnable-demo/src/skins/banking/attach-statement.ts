import { sendMessageWithAttachment } from "@/shell/attach";
import type { AttachmentDocument } from "@/shell/attach";
import { EXPENSE_CSV_PUBLIC_PATH } from "@/skins/banking/harness/types";
// The pill's message stays in `suggestions.ts` next to the pill that carries it,
// so the pill and this send are literally the same value — and it is the same
// constant Arm C's router matches on, so the attachment path cannot drift away
// from the routing path either.
import { EXPENSE_PILL_MESSAGE } from "@/skins/banking/suggestions";

/**
 * The long-running harness beat's statement, staged into the composer exactly
 * the way the Q2 invoice is (`attach-invoice.ts`) — same shell helper, same
 * guarantees: bytes verified before staging, staging confirmed before sending,
 * and every failure reported through `console.error` AND `window.alert` rather
 * than sending a prompt about a statement that never arrived.
 *
 * WHAT THIS IS AND IS NOT, because the distinction is easy to overstate on
 * stage. This makes the statement visible to the presenter and to the MODEL,
 * which is why the beat now shows a file where its message claims one. It does
 * NOT change how the harness reads it: `defineTool`'s `execute` receives only
 * its parsed args — no message, no attachment
 * (`packages/runtime/src/agent/index.ts`) — so the tool fetches this same URL
 * server-side through `harness/csv.ts`. Same file, same bytes, two readers.
 *
 * The one claim to avoid: if someone drags in a DIFFERENT csv, the harness still
 * analyses the bundled fixture. Attaching an arbitrary statement and having it
 * analysed is a different feature, and this is not it.
 */
const OFFSITE_STATEMENT: AttachmentDocument = {
  // The same constant `harness/csv.ts` builds its server-side URL from, so the
  // file the presenter attaches and the file the harness reads cannot diverge.
  url: EXPENSE_CSV_PUBLIC_PATH,
  filename: "personal-card-statement-july-2026.csv",
  // NOT inferred from the `.csv` in the filename — this selects the byte check
  // that runs before staging, and inferring it from a name is exactly how an
  // HTML error page would get through.
  kind: "csv",
};

/** The pill path — stage the statement, then drive the real composer. */
export const sendExpensesWithStatement = (): Promise<boolean> =>
  sendMessageWithAttachment(OFFSITE_STATEMENT, EXPENSE_PILL_MESSAGE);
