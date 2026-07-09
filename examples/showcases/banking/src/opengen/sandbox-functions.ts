import { z } from "zod";
import type { SandboxFunction } from "@copilotkit/react-core/v2";
import type {
  Card,
  CardBrand,
  ExpensePolicy,
  Transaction,
} from "@/app/api/v1/data";
import { withOverLimit, isOverLimit } from "@/lib/over-limit";

/**
 * The single source the sandbox reads. Holds FULL domain objects (mirrors
 * `useCreditCards`); every handler projects to a DTO at the boundary so no
 * secret (Card.pin, etc.) ever crosses into the iframe's LLM-authored JS.
 * <SandboxDataSync/> keeps this in sync with the app's live view.
 */
export type Snapshot = {
  transactions: Transaction[];
  policies: ExpensePolicy[];
  cards: Card[];
};
let snapshot: Snapshot = { transactions: [], policies: [], cards: [] };
/**
 * Replace the snapshot the handlers read. Takes ownership of `next` (and its
 * arrays) by reference — it does not clone. The sole caller is <SandboxDataSync/>,
 * which passes React state treated as immutable, so the reference is never mutated
 * in place after handoff.
 */
export function setSandboxSnapshot(next: Snapshot): void {
  snapshot = next;
}

// ── Projection DTOs (allowlist — no raw domain objects cross the boundary) ──
type SafeCard = {
  id: string;
  last4: string;
  type: CardBrand;
  expensePolicyId?: string;
};
type SafeTransaction = {
  id: string;
  title: string;
  amount: number;
  date: string;
  policyId: string;
  cardId: string;
  status: Transaction["status"];
  overLimit: boolean;
};
type SafePolicy = {
  id: string;
  type: ExpensePolicy["type"];
  limit: number;
  spent: number;
};
type Kpis = {
  totalSpend: number;
  pendingCount: number;
  overLimitCount: number;
  policyCount: number;
};

const toSafeCard = (c: Card): SafeCard => ({
  id: c.id,
  last4: c.last4,
  type: c.type,
  expensePolicyId: c.expensePolicyId,
});
const toSafePolicy = (p: ExpensePolicy): SafePolicy => ({
  id: p.id,
  type: p.type,
  limit: p.limit,
  spent: p.spent,
});

function safeTransactions(status?: Transaction["status"]): SafeTransaction[] {
  const withFlag = withOverLimit(snapshot.transactions, snapshot.policies);
  const filtered = status
    ? withFlag.filter((t) => t.status === status)
    : withFlag;
  return filtered.map((t) => ({
    id: t.id,
    title: t.title,
    amount: t.amount,
    date: t.date,
    policyId: t.policyId,
    cardId: t.cardId,
    status: t.status,
    overLimit: t.overLimit,
  }));
}

export function computeKpis(s: Snapshot): Kpis {
  const pending = s.transactions.filter((t) => t.status === "pending");
  return {
    totalSpend: s.transactions
      .filter((t) => t.status === "approved")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0),
    pendingCount: pending.length,
    overLimitCount: pending.filter((t) => isOverLimit(t, s.policies)).length,
    policyCount: s.policies.length,
  };
}

/**
 * Stable module-scope array — safe to hand straight to the provider. The
 * handlers close over the mutable module snapshot, so the array identity never
 * changes (avoids per-render re-registration + dev-console warnings from
 * useStableArrayProp) while the DATA stays live.
 */
export const sandboxFunctions: SandboxFunction[] = [
  {
    name: "getTransactions",
    description:
      "Return the current transactions (real app data). Each includes `overLimit` " +
      "(true when the pending charge exceeds its policy limit and has no active " +
      "exception). Optional `status` filters to pending/approved/denied.",
    parameters: z.object({
      status: z.enum(["pending", "approved", "denied"]).optional(),
    }),
    handler: async ({ status }: { status?: Transaction["status"] }) =>
      safeTransactions(status),
  },
  {
    name: "getPolicies",
    description:
      "Return the expense policies (id, type, limit, spent) — real app data.",
    parameters: z.object({}),
    handler: async () => snapshot.policies.map(toSafePolicy),
  },
  {
    name: "getCards",
    description:
      "Return the expense cards (id, last4, type, assigned policy) — real app data. No PIN or expiry is exposed.",
    parameters: z.object({}),
    handler: async () => snapshot.cards.map(toSafeCard),
  },
  {
    name: "getKpis",
    description:
      "Return headline KPIs: totalSpend, pendingCount, overLimitCount, policyCount — real app data.",
    parameters: z.object({}),
    handler: async () => computeKpis(snapshot),
  },
];
