/**
 * Shared domain types for the Personal Finance Copilot.
 *
 * This is the foundational contract every other slot imports. Keep these
 * JSON-friendly and stable — changing a field here ripples across the app.
 */

export type CurrencyCode =
  | "USD"
  | "EUR"
  | "GBP"
  | "JPY"
  | "PHP"
  | "INR"
  | "AUD"
  | "CAD";

export type AccountType = "cash" | "bank" | "card" | "savings";

export type TxnKind = "expense" | "income";

export type TxnSource = "manual" | "chat" | "receipt";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  balance: number;
  icon: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  kind: TxnKind;
  amount: number;
  currency: CurrencyCode;
  category: string;
  merchant: string;
  note?: string;
  /** ISO yyyy-mm-dd */
  date: string;
  source: TxnSource;
  receiptUri?: string;
}

export interface Budget {
  id: string;
  category: string;
  period: "monthly";
  limit: number;
  currency: CurrencyCode;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  kind: TxnKind;
}
