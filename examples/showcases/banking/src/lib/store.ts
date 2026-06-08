import seed from "@/data/seed.json";
import type {
  Card,
  ExpensePolicy,
  Member,
  Transaction,
} from "@/app/api/v1/data";

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
};

const db = structuredClone(seed) as DB;

// ---- Reads --------------------------------------------------------------

export const cards = (): Card[] => db.cards;
export const team = (): Member[] => db.team;
export const policies = (): ExpensePolicy[] => db.policies;
export const transactions = (): Transaction[] => db.transactions;

export const findCard = (id: string): Card | undefined =>
  db.cards.find((c) => c.id === id);

export const findPolicy = (id: string): ExpensePolicy | undefined =>
  db.policies.find((p) => p.id === id);

export const findTransaction = (id: string): Transaction | undefined =>
  db.transactions.find((t) => t.id === id);

// ---- Mutations ----------------------------------------------------------

export const addCard = (card: Card): Card => {
  db.cards.push(card);
  return card;
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
