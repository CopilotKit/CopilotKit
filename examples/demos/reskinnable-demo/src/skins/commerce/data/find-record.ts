import type { Order, Product, ReturnRequest } from "./types";

/**
 * Resolving the loose reference an AGENT supplies ("BW-1041", "#4471", "Dana",
 * "the cedar hoodie") to one ledger row.
 *
 * These live here, as pure functions over the rows, rather than as closures
 * inside `../tools.tsx`, for two reasons: the write tools that call them are the
 * agent's mutation paths, and a closure is not directly testable.
 *
 * ── The bug this module exists to make unrepresentable ──────────────────────
 *
 * Every finder below ends in a SUBSTRING match, and `"anything".includes("")`
 * is TRUE. So an empty needle used to match the FIRST row: a tool called with a
 * blank or whitespace-only argument resolved to `rows[0]`, and `holdOrder` /
 * `notifyCustomer` / `postOrderNote` then mutated an arbitrary wrong record and
 * returned a confident success receipt naming a customer nobody had mentioned.
 *
 * The needle comes from the model, out of conversation, so a blank one is an
 * ORDINARY occurrence rather than an edge case — and the failure mode is a
 * wrong-record WRITE, not a miss. The guard therefore lives ONCE, here at
 * normalisation: a needle that identifies nothing normalises to `null`, and
 * every finder returns `undefined` before it matches anything. The call sites
 * already refuse on `undefined` ("No order matches …"), so refusing is the
 * behaviour they get for free.
 */

/**
 * Fold a caller-supplied reference into the comparison key the finders use, or
 * `null` when it identifies nothing.
 *
 * A leading `#` is dropped so "#4471" finds order 4471, which also means a bare
 * "#" — a plausible thing for a model to emit when it has no number to hand —
 * normalises to nothing rather than to the empty substring that matches
 * everything.
 */
export function normalizeNeedle(
  needle: string | null | undefined,
): string | null {
  const key = (needle ?? "").trim().replace(/^#+/, "").trim().toLowerCase();
  return key.length > 0 ? key : null;
}

export function findOrder(
  rows: readonly Order[],
  needle: string,
): Order | undefined {
  const key = normalizeNeedle(needle);
  if (key === null) return undefined;
  return (
    rows.find((o) => o.id === needle) ??
    rows.find((o) => o.number === key) ??
    rows.find((o) => o.customerName.toLowerCase() === key) ??
    rows.find((o) => o.customerName.toLowerCase().includes(key))
  );
}

export function findProduct(
  rows: readonly Product[],
  needle: string,
): Product | undefined {
  const key = normalizeNeedle(needle);
  if (key === null) return undefined;
  return (
    rows.find((p) => p.id === needle) ??
    rows.find((p) => p.sku.toLowerCase() === key) ??
    rows.find((p) => p.name.toLowerCase() === key) ??
    rows.find((p) => p.name.toLowerCase().includes(key))
  );
}

export function findReturn(
  rows: readonly ReturnRequest[],
  needle: string,
): ReturnRequest | undefined {
  const key = normalizeNeedle(needle);
  if (key === null) return undefined;
  return (
    rows.find((r) => r.id === needle) ??
    rows.find((r) => r.customerName.toLowerCase() === key) ??
    rows.find((r) => r.orderNumber === key) ??
    rows.find((r) => r.customerName.toLowerCase().includes(key))
  );
}
