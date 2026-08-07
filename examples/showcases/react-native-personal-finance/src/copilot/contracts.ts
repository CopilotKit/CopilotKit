/**
 * Shared CopilotKit contract surface.
 *
 * Every conversational slot imports from here so tool names and the shape of
 * the args the agent fills in stay consistent across the app. Keep all fields
 * primitive and JSON-friendly — these are what the LLM emits.
 */

import type { AccountType, CurrencyCode, TxnKind } from "../types";

/** Canonical tool names. Use these constants instead of string literals. */
export const TOOLS = {
  addTransaction: "addTransaction",
  createAccount: "createAccount",
  setBudget: "setBudget",
  editBudget: "editBudget",
  getAccounts: "getAccounts",
  getBudgets: "getBudgets",
  getRecentTransactions: "getRecentTransactions",
  getTopExpenses: "getTopExpenses",
  getSpendByCategory: "getSpendByCategory",
  parseReceipt: "parseReceipt",
} as const;

export type ToolName = (typeof TOOLS)[keyof typeof TOOLS];

/**
 * Args for adding a transaction by chat. The agent may identify the account
 * either by id (preferred when known) or by a human name like "Amex".
 */
export interface AddTransactionArgs {
  accountId?: string;
  accountName?: string;
  kind: TxnKind;
  amount: number;
  currency: CurrencyCode;
  category: string;
  merchant: string;
  note?: string;
  /** ISO yyyy-mm-dd; defaults to today when omitted. */
  date?: string;
}

export interface CreateAccountArgs {
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /** Opening balance; defaults to 0 when omitted. */
  balance?: number;
  /** Emoji icon for the account. */
  icon?: string;
}

export interface SetBudgetArgs {
  category: string;
  limit: number;
  currency: CurrencyCode;
  /** Only 'monthly' is supported today; reserved for future periods. */
  period?: "monthly";
}

export interface EditBudgetArgs {
  /** Target budget by id, or by category when the id is unknown. */
  id?: string;
  category?: string;
  limit?: number;
  currency?: CurrencyCode;
}

/**
 * Args for `getSpendByCategory`. Currently scope is fixed to the current
 * month; the field is reserved for future ranges (e.g. 'last30', 'ytd').
 */
export interface SpendByCategoryArgs {
  range?: "thisMonth";
}

/**
 * Draft extracted from a receipt photo, surfaced for human-in-the-loop
 * confirmation before it becomes a Transaction.
 */
export interface ReceiptDraft {
  merchant: string;
  amount: number;
  currency: CurrencyCode;
  /** ISO yyyy-mm-dd. */
  date: string;
  suggestedCategory: string;
}
