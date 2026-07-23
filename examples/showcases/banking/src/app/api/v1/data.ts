export enum CardBrand {
  Visa = "Visa",
  MasterCard = "MasterCard",
}

export const CARD_COLORS = {
  [CardBrand.Visa]: "bg-blue-500",
  [CardBrand.MasterCard]: "bg-red-500",
};

export interface Card {
  id: string;
  last4: string;
  expiry: string;
  type: CardBrand;
  color: string;
  pin: string;
  expensePolicyId?: string;
}

export enum MemberRole {
  Admin = "Admin",
  Assistant = "Assistant",
  Member = "Member",
}

export enum ExpenseRole {
  Marketing = "Marketing",
  Engineering = "Engineering",
  Executive = "Executive",
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  team: ExpenseRole;
}

export interface ExpensePolicy {
  id: string;
  type: ExpenseRole;
  limit: number;
  spent: number;
}

export interface TransactionNote {
  content: string;
  userId: string;
  date: string;
}

export interface PolicyException {
  id: string;
  transactionId: string;
  code: string;
  status: "draft" | "approved";
  createdAt: string;
}

export interface Transaction {
  id: string;
  title: string;
  note?: TransactionNote;
  amount: number;
  date: string;
  policyId: string;
  cardId: string;
  status: "pending" | "denied" | "approved";
  activeExceptionId?: string | null;
}

export interface NewCardRequest {
  type: CardBrand;
  color: string;
  pin: string;
}

// A copilot-generated report artifact, filed in the dashboard's Reports tab.
// Narrative fields come from the agent; id/createdAt are server-set.
export interface Report {
  id: string;
  title: string;
  summary: string;
  highlights: string[];
  createdAt: string;
  createdBy: string;
}

export function generateUniqueId() {
  return Math.random().toString(36).slice(2, 15);
}

// The domain data store has moved to `@/lib/store`. This module is now the
// single source of truth for shared types/enums only. Routes and server
// actions should read/write through the store's typed accessors.
