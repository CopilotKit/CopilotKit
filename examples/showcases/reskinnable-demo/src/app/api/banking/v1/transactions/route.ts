import type { Transaction } from "@/skins/banking/data/data";
import { generateUniqueId } from "@/skins/banking/data/data";
import * as store from "@/skins/banking/data/store";

// Get all transactions
export const GET = async () => {
  return new Response(JSON.stringify(store.transactions()), { status: 200 });
};

/**
 * File a card charge against the ledger.
 *
 * The ACCEPTED REQUEST CONTRACT is deliberately flat and fixed, so an external
 * filer (the Codex expense harness) never learns the ledger's internals:
 *
 *   body: { merchant: string, amount: number, note?: string }
 *   201:  { id: string }
 *   400:  { error: string }
 *
 * This route owns the whole mapping onto the real model — `merchant` → `title`,
 * the flat `note` string → a `TransactionNote` object, plus every required field
 * the caller does not send.
 */
export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null);
  const merchant =
    typeof body?.merchant === "string" ? body.merchant.trim() : "";
  const amount = typeof body?.amount === "number" ? body.amount : Number.NaN;
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (!merchant) {
    return new Response(JSON.stringify({ error: "merchant is required" }), {
      status: 400,
    });
  }
  if (!Number.isFinite(amount)) {
    return new Response(
      JSON.stringify({ error: "amount must be a finite number" }),
      { status: 400 },
    );
  }

  // Attribute the charge to the first seeded card. Its policy is resolved
  // THROUGH `findPolicy` rather than trusted: every seeded card's
  // `expensePolicyId` is a legacy id that matches no policy in the current seed
  // (cards carry e.g. `8r5c3m4n5o`, policies are `pol-technology` / `pol-gtm` /
  // `pol-gna`), and seeded transactions carry their `policyId` directly rather
  // than inheriting it from the card. A charge filed under an unresolvable
  // policy silently drops out of the over-limit derivation and the report's
  // per-policy grouping, so fall back to a policy that actually exists.
  const card = store.cards()[0];
  const policyId =
    (card?.expensePolicyId
      ? store.findPolicy(card.expensePolicyId)?.id
      : undefined) ?? store.policies()[0]?.id;
  if (!card || !policyId) {
    return new Response(
      JSON.stringify({ error: "ledger has no card or policy to file against" }),
      { status: 500 },
    );
  }

  // ISO yyyy-mm-dd, matching the seeded ledger's `date` format.
  const today = new Date().toISOString().slice(0, 10);
  // The ledger stores spend as NEGATIVE (see `ChargeRow.amount`); a positive
  // amount reads as income and is excluded from every spend chart. The caller
  // sends a plain expense magnitude, so normalize the sign here.
  const filed: Transaction = {
    id: generateUniqueId(),
    title: merchant,
    amount: -Math.abs(amount),
    date: today,
    policyId,
    cardId: card.id,
    // Filed FOR REIMBURSEMENT, never self-approved: pending rows surface in the
    // approvals queue and on /banking/charges, which is the demo evidence.
    status: "pending",
    // The note is attributed to the ledger's first member, the same convention
    // the seeded notes use.
    ...(note
      ? {
          note: {
            content: note,
            userId: store.team()[0]?.id ?? "",
            date: today,
          },
        }
      : {}),
  };

  store.addTransaction(filed);
  return new Response(JSON.stringify({ id: filed.id }), { status: 201 });
};
