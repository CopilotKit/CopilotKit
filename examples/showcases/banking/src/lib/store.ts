import seed from "@/data/seed.json";
import type {
  Card,
  ExpensePolicy,
  Member,
  PolicyException,
  Report,
  Transaction,
} from "@/app/api/v1/data";
import { generateUniqueId } from "@/app/api/v1/data";
import {
  isJustifying,
  isValidExceptionCode,
} from "@/app/api/v1/policy-exception-codes";

/**
 * In-memory, file-seeded data store for the banking showcase demo.
 *
 * - Seed values are loaded once from `src/data/seed.json` at module-init
 *   and deep-cloned so mutations don't bleed back into the imported JSON.
 * - All mutations live for the running server process only; restarting the
 *   dev server resets state back to seed. This is intentional demo behavior
 *   (no disk write-back, no database).
 * - The single `as DB` cast at the JSON seam is the only permitted cast:
 *   imported JSON is typed as widened literals, so a one-shot narrowing
 *   to the typed enums (CardBrand / MemberRole / ExpenseRole /
 *   transaction status) is needed exactly here. Mutators stay fully typed.
 */
type DB = {
  cards: Card[];
  team: Member[];
  policies: ExpensePolicy[];
  transactions: Transaction[];
  exceptions: PolicyException[];
  reports: Report[];
};

// Reports are copilot-generated at runtime and never seeded, so the JSON
// seam cast covers only the seeded collections.
const db: DB = {
  ...(structuredClone(seed) as Omit<DB, "reports">),
  reports: [],
};
// Older seeds (pre-policy-exception) may not carry an `exceptions` array.
// Guarantee it exists so the accessors/mutators below never hit undefined.
if (!db.exceptions) db.exceptions = [];

/**
 * Dev-only: restore the in-memory store to the original seed snapshot.
 * Mutations (approvals, filed exceptions, new cards, policy spend) live for the
 * server process only; this re-seeds them in place so the over-limit demo (e.g.
 * the $5,000 Google Ads charge) can be re-run without restarting the server.
 * Exposed via `POST /api/v1/dev/reset`. Re-assigns array contents (the `db`
 * binding is const but its properties are mutable, and the read accessors
 * return the live `db.*` references, so callers see the fresh data).
 */
export const reset = (): void => {
  // Reports are copilot-generated at runtime and never seeded (same seam as
  // module-init above), so the cast covers only the seeded collections and
  // reports re-seed to empty.
  const fresh = structuredClone(seed) as Omit<DB, "reports">;
  db.cards = fresh.cards;
  db.team = fresh.team;
  db.policies = fresh.policies;
  db.transactions = fresh.transactions;
  db.exceptions = fresh.exceptions ?? [];
  db.reports = [];
};

// ---- Reads --------------------------------------------------------------

export const cards = (): Card[] => db.cards;
export const team = (): Member[] => db.team;
export const policies = (): ExpensePolicy[] => db.policies;
export const transactions = (): Transaction[] => db.transactions;
export const exceptions = (): PolicyException[] => db.exceptions;
export const reports = (): Report[] => db.reports;

export const findCard = (id: string): Card | undefined =>
  db.cards.find((c) => c.id === id);

export const findPolicy = (id: string): ExpensePolicy | undefined =>
  db.policies.find((p) => p.id === id);

export const findTransaction = (id: string): Transaction | undefined =>
  db.transactions.find((t) => t.id === id);

export const findException = (id: string): PolicyException | undefined =>
  db.exceptions.find((e) => e.id === id);

// ---- Business rules -----------------------------------------------------

/**
 * True iff approving this transaction would keep its policy at or under
 * its limit. A transaction whose policy is missing is treated as within
 * limit (nothing to gate against). Amounts are negative, so the spend is
 * `Math.abs(txn.amount)`.
 */
export const isWithinPolicyLimit = (txn: Transaction): boolean => {
  const p = findPolicy(txn.policyId);
  if (!p) return true;
  return p.spent + Math.abs(txn.amount) <= p.limit;
};

/**
 * True iff the transaction has an active exception that is both approved
 * AND filed under a justifying code (`isJustifying`). Filing an exception
 * with a non-justifying code records it for history but does NOT lift the
 * policy-limit gate.
 */
export const hasApprovedException = (txn: Transaction): boolean => {
  if (!txn.activeExceptionId) return false;
  const e = findException(txn.activeExceptionId);
  return !!e && e.status === "approved" && isJustifying(e.code);
};

/**
 * True iff this transaction may be approved: either it is within its
 * policy limit, or it carries an approved, justifying exception that
 * lifts the gate.
 */
export const canApprove = (txn: Transaction): boolean =>
  isWithinPolicyLimit(txn) || hasApprovedException(txn);

// ---- Mutations ----------------------------------------------------------

export const addCard = (card: Card): Card => {
  db.cards.push(card);
  return card;
};

/** File a copilot-generated report; newest first so the Reports tab leads with it. */
export const addReport = (report: Omit<Report, "id" | "createdAt">): Report => {
  const filed: Report = {
    ...report,
    id: generateUniqueId(),
    createdAt: new Date().toISOString(),
  };
  db.reports.unshift(filed);
  return filed;
};

export const updateCardPin = (
  cardId: string,
  pin: string,
): Card | undefined => {
  const card = db.cards.find((c) => c.id === cardId);
  if (!card) return undefined;
  card.pin = pin;
  return card;
};

export const assignPolicyToCard = (
  cardId: string,
  policyId: string,
): Card | undefined => {
  const card = db.cards.find((c) => c.id === cardId);
  if (!card) return undefined;
  card.expensePolicyId = policyId;
  return card;
};

export const addPolicy = (policy: ExpensePolicy): ExpensePolicy => {
  db.policies.push(policy);
  return policy;
};

export const updateTransaction = (
  id: string,
  patch: Partial<Transaction>,
): Transaction | undefined => {
  const idx = db.transactions.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  db.transactions[idx] = { ...db.transactions[idx], ...patch };
  return db.transactions[idx];
};

export const addMember = (member: Member): Member => {
  db.team.push(member);
  return member;
};

export const updateMember = (
  id: string,
  patch: Partial<Pick<Member, "role" | "team">>,
): Member | undefined => {
  const idx = db.team.findIndex((m) => m.id === id);
  if (idx === -1) return undefined;
  db.team[idx] = {
    ...db.team[idx],
    role: patch.role ?? db.team[idx].role,
    team: patch.team ?? db.team[idx].team,
  };
  return db.team[idx];
};

export const removeMember = (id: string): Member[] | undefined => {
  const idx = db.team.findIndex((m) => m.id === id);
  if (idx === -1) return undefined;
  db.team.splice(idx, 1);
  return db.team;
};

/**
 * Open a draft policy exception against a transaction. Throws plain
 * Errors with code-like messages (`NOT_FOUND`, `INVALID_EXCEPTION_CODE`)
 * that the calling route maps to HTTP status. The catalogue check forces
 * the agent to learn valid codes via `/knowledge` rather than inventing
 * plausible-looking strings.
 */
export const openPolicyException = (
  transactionId: string,
  code: string,
): PolicyException => {
  if (!findTransaction(transactionId)) throw new Error("NOT_FOUND");
  if (!isValidExceptionCode(code)) throw new Error("INVALID_EXCEPTION_CODE");
  const exception: PolicyException = {
    id: generateUniqueId(),
    transactionId,
    code,
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  db.exceptions.push(exception);
  return exception;
};

/**
 * Finalize a draft policy exception. Auto-approves (no review step in the
 * demo) and links the approved exception to its transaction's
 * `activeExceptionId`, which is what lifts the policy-limit gate (provided
 * the code is justifying). Throws plain Errors (`NOT_FOUND`,
 * `ALREADY_FINALIZED`) that the calling route maps to HTTP status.
 */
export const finalizePolicyException = (
  exceptionId: string,
): PolicyException => {
  const exc = findException(exceptionId);
  if (!exc) throw new Error("NOT_FOUND");
  if (exc.status !== "draft") throw new Error("ALREADY_FINALIZED");
  exc.status = "approved";
  updateTransaction(exc.transactionId, { activeExceptionId: exc.id });
  return exc;
};
