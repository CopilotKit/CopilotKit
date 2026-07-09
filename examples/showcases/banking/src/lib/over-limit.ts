import type { ExpensePolicy, Transaction } from "@/app/api/v1/data";

/** A transaction annotated with the derived over-limit flag. */
export type TransactionWithOverLimit = Transaction & { overLimit: boolean };

/**
 * A pending charge is "over limit" when approving it would push its policy past
 * the limit AND it has no clearing exception yet. Single source of truth for the
 * over-limit derivation across the demo's data surfaces — the chat readable
 * (copilot-context), the A2UI report renderers, and the OGUI sandbox handlers —
 * so they can never disagree.
 */
export function isOverLimit(
  transaction: Transaction,
  policies: ExpensePolicy[],
): boolean {
  const policy = policies.find((p) => p.id === transaction.policyId);
  return (
    !!policy &&
    policy.spent + Math.abs(transaction.amount) > policy.limit &&
    !transaction.activeExceptionId
  );
}

/** Map transactions to include the derived `overLimit` flag. */
export function withOverLimit(
  transactions: Transaction[],
  policies: ExpensePolicy[],
): TransactionWithOverLimit[] {
  return transactions.map((t) => ({
    ...t,
    overLimit: isOverLimit(t, policies),
  }));
}
