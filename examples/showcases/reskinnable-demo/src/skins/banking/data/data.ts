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

/**
 * The org units a charge can belong to.
 *
 * Deliberately WIDER than `ExpenseRole` (which types a team member's own team)
 * and separate from `PolicyType` below: a charge's team is an org unit, while a
 * policy is a budget envelope, and several teams share one envelope. Collapsing
 * the two is what previously forced a choice between a seven-slice donut and
 * discarding real charges.
 */
export const CHARGE_TEAMS = [
  "Engineering",
  "Marketing",
  "Sales",
  "Executive",
  "Operations",
  "Finance",
  "People",
] as const;
export type ChargeTeam = (typeof CHARGE_TEAMS)[number];

export const CHARGE_CATEGORIES = [
  "Cloud Infrastructure",
  "Advertising",
  "SaaS & Software",
  "Travel",
  "Payroll & Benefits",
  "Office & Facilities",
  "Professional Services",
  "Marketing Events",
  "Hardware",
  "Meals & Entertainment",
] as const;
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

/**
 * The three expense-policy envelopes every charge is governed by.
 *
 * Separate from `ExpenseRole` on purpose — see `CHARGE_TEAMS`. Renaming these
 * away from team names is what stops the two axes reading as one thing.
 */
export enum PolicyType {
  Technology = "Technology",
  GoToMarket = "Go-to-Market",
  GeneralAndAdmin = "G&A",
  /**
   * Not a seeded envelope. The report groups document-sourced additions here
   * when their model-authored team maps to no real envelope, so one stray team
   * name cannot mint a policy segment of its own.
   */
  Unattributed = "Unattributed",
}

/** Which policy envelope governs a given org team. Many-to-one. */
const TEAM_POLICY: Record<ChargeTeam, PolicyType> = {
  Engineering: PolicyType.Technology,
  Operations: PolicyType.Technology,
  Marketing: PolicyType.GoToMarket,
  Sales: PolicyType.GoToMarket,
  Executive: PolicyType.GeneralAndAdmin,
  Finance: PolicyType.GeneralAndAdmin,
  People: PolicyType.GeneralAndAdmin,
};

/**
 * Resolve the policy envelope for a team name.
 *
 * Takes a plain string rather than `ChargeTeam` because one caller is the
 * agent: `ReportAddition.team` is model-authored free text, so an unknown team
 * has to degrade rather than throw. Returns `undefined` when unmapped, and the
 * caller decides what an unattributable charge means.
 */
export const policyForTeam = (team: string): PolicyType | undefined =>
  TEAM_POLICY[team as ChargeTeam];

export interface ExpensePolicy {
  id: string;
  type: PolicyType;
  limit: number;
  /**
   * Approved spend against this policy. DERIVED from the ledger by
   * `store.policies()` on every read — never authored and never stored in the
   * seed, so it cannot drift from the transactions it summarises.
   */
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
  /**
   * The org unit that incurred the charge. Distinct from the charge's policy
   * (`policyId`) — see `CHARGE_TEAMS`.
   *
   * Optional because not every Transaction is a real card charge: the report
   * folds document-sourced additions in as synthetic transactions, and those
   * have a policy but no org team or merchant category. Every charge in the
   * seeded ledger carries both.
   */
  team?: ChargeTeam;
  category?: ChargeCategory;
  /**
   * Note there is no `"over-limit"` member: over-limit is DERIVED from the
   * charge's amount against its policy's remaining headroom (`isOverLimit`),
   * never stored, so it cannot contradict the numbers it is drawn from.
   * `"flagged"` is a review state that does not gate approval.
   */
  status: "pending" | "denied" | "approved" | "flagged";
  activeExceptionId?: string | null;
}

export interface NewCardRequest {
  type: CardBrand;
  color: string;
  pin: string;
}

// A copilot-generated report artifact, filed in the dashboard's Reports tab.
// Narrative fields come from the agent; id/createdAt are server-set.
/** Spend drawn from an attached document (e.g. an uploaded invoice) that the
 * report folds INTO its charts on top of the live ledger figures. `team` should
 * match an expense policy type when possible so it lands in the right segment. */
export interface ReportAddition {
  team: string;
  amount: number;
  label?: string;
}

export interface Report {
  id: string;
  title: string;
  summary: string;
  highlights: string[];
  createdAt: string;
  createdBy: string;
  /** Optional spend pulled from an attached document, merged into the report's
   * Spend Breakdown + Income vs Expenses charts. */
  additions?: ReportAddition[];
}

export function generateUniqueId() {
  return Math.random().toString(36).slice(2, 15);
}

// The domain data store has moved to `@/skins/banking/data/store`. This module is now the
// single source of truth for shared types/enums only. Routes and server
// actions should read/write through the store's typed accessors.
