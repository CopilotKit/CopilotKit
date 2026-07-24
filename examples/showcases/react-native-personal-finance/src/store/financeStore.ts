/**
 * Central finance store (zustand).
 *
 * Holds accounts, transactions, budgets, categories and the user's base
 * currency. Mutating actions keep account balances in sync. Selector helpers
 * are plain functions (NOT hooks) so they can be called from anywhere —
 * tool handlers, render code, or tests — via `useFinanceStore.getState()`.
 */

import { create } from "zustand";
import type {
  Account,
  Budget,
  Category,
  CurrencyCode,
  Transaction,
} from "../types";
import { convert } from "../lib/currency";

/**
 * Small id helper. We avoid `crypto.randomUUID()` because the RN TS lib config
 * doesn't type the `crypto` global; this is collision-safe enough for a demo.
 */
let __idCounter = 0;
function makeId(prefix: string): string {
  __idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${__idCounter.toString(36)}`;
}

/** ISO yyyy-mm-dd for "today" in local time. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FinanceState {
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  categories: Category[];
  baseCurrency: CurrencyCode;

  addTransaction: (input: Omit<Transaction, "id">) => Transaction;
  createAccount: (input: Omit<Account, "id">) => Account;
  setBudget: (input: Omit<Budget, "id">) => Budget;
  editBudget: (
    id: string,
    patch: Partial<Omit<Budget, "id">>,
  ) => Budget | undefined;
  deleteTransaction: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Seed data — realistic, multi-currency sample so every screen has something
// to render on first launch.
// ---------------------------------------------------------------------------

const SEED_ACCOUNTS: Account[] = [
  {
    id: "acc_checking",
    name: "Checking",
    type: "bank",
    currency: "USD",
    balance: 4280.55,
    icon: "🏦",
  },
  {
    id: "acc_amex",
    name: "Amex",
    type: "card",
    currency: "USD",
    balance: -842.19,
    icon: "💳",
  },
  {
    id: "acc_travel",
    name: "Travel Fund",
    type: "savings",
    currency: "EUR",
    balance: 1650.0,
    icon: "✈️",
  },
];

const SEED_CATEGORIES: Category[] = [
  { id: "cat_food", name: "Food & Drink", icon: "☕", kind: "expense" },
  { id: "cat_groceries", name: "Groceries", icon: "🛒", kind: "expense" },
  { id: "cat_transport", name: "Transport", icon: "🚕", kind: "expense" },
  { id: "cat_shopping", name: "Shopping", icon: "🛍️", kind: "expense" },
  { id: "cat_bills", name: "Bills", icon: "🧾", kind: "expense" },
  {
    id: "cat_entertainment",
    name: "Entertainment",
    icon: "🎬",
    kind: "expense",
  },
  { id: "cat_salary", name: "Salary", icon: "💸", kind: "income" },
  { id: "cat_health", name: "Health", icon: "💊", kind: "expense" },
];

const SEED_BUDGETS: Budget[] = [
  {
    id: "bud_food",
    category: "Food & Drink",
    period: "monthly",
    limit: 400,
    currency: "USD",
  },
  {
    id: "bud_groceries",
    category: "Groceries",
    period: "monthly",
    limit: 600,
    currency: "USD",
  },
  {
    id: "bud_transport",
    category: "Transport",
    period: "monthly",
    limit: 150,
    currency: "USD",
  },
  {
    id: "bud_shopping",
    category: "Shopping",
    period: "monthly",
    limit: 300,
    currency: "USD",
  },
  {
    id: "bud_entertainment",
    category: "Entertainment",
    period: "monthly",
    limit: 120,
    currency: "USD",
  },
];

/**
 * Build seed transactions relative to "now" so they always look recent.
 * `daysAgo` keeps the demo's dates fresh regardless of when it's run.
 */
function seedTransactions(): Transaction[] {
  const daysAgo = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  return [
    {
      id: "txn_01",
      accountId: "acc_checking",
      kind: "income",
      amount: 5200,
      currency: "USD",
      category: "Salary",
      merchant: "Acme Corp",
      note: "May payroll",
      date: daysAgo(1),
      source: "manual",
    },
    {
      id: "txn_02",
      accountId: "acc_amex",
      kind: "expense",
      amount: 18.75,
      currency: "USD",
      category: "Food & Drink",
      merchant: "Blue Bottle Coffee",
      date: daysAgo(1),
      source: "chat",
    },
    {
      id: "txn_03",
      accountId: "acc_amex",
      kind: "expense",
      amount: 132.4,
      currency: "USD",
      category: "Groceries",
      merchant: "Whole Foods",
      date: daysAgo(2),
      source: "receipt",
    },
    {
      id: "txn_04",
      accountId: "acc_amex",
      kind: "expense",
      amount: 24.6,
      currency: "USD",
      category: "Transport",
      merchant: "Uber",
      date: daysAgo(3),
      source: "chat",
    },
    {
      id: "txn_05",
      accountId: "acc_amex",
      kind: "expense",
      amount: 15.99,
      currency: "USD",
      category: "Entertainment",
      merchant: "Netflix",
      note: "Monthly subscription",
      date: daysAgo(4),
      source: "manual",
    },
    {
      id: "txn_06",
      accountId: "acc_checking",
      kind: "expense",
      amount: 1450,
      currency: "USD",
      category: "Bills",
      merchant: "Rent",
      date: daysAgo(5),
      source: "manual",
    },
    {
      id: "txn_07",
      accountId: "acc_amex",
      kind: "expense",
      amount: 89.0,
      currency: "USD",
      category: "Shopping",
      merchant: "Uniqlo",
      date: daysAgo(6),
      source: "manual",
    },
    {
      id: "txn_08",
      accountId: "acc_travel",
      kind: "expense",
      amount: 42.5,
      currency: "EUR",
      category: "Food & Drink",
      merchant: "Café de Flore",
      note: "Paris trip",
      date: daysAgo(7),
      source: "receipt",
    },
    {
      id: "txn_09",
      accountId: "acc_travel",
      kind: "expense",
      amount: 16.0,
      currency: "EUR",
      category: "Transport",
      merchant: "RATP Metro",
      date: daysAgo(8),
      source: "chat",
    },
    {
      id: "txn_10",
      accountId: "acc_amex",
      kind: "expense",
      amount: 54.32,
      currency: "USD",
      category: "Groceries",
      merchant: "Trader Joe’s",
      date: daysAgo(9),
      source: "manual",
    },
    {
      id: "txn_11",
      accountId: "acc_amex",
      kind: "expense",
      amount: 32.0,
      currency: "USD",
      category: "Health",
      merchant: "CVS Pharmacy",
      date: daysAgo(11),
      source: "manual",
    },
    {
      id: "txn_12",
      accountId: "acc_amex",
      kind: "expense",
      amount: 27.5,
      currency: "USD",
      category: "Entertainment",
      merchant: "AMC Theatres",
      date: daysAgo(13),
      source: "chat",
    },
  ];
}

export const useFinanceStore = create<FinanceState>((set) => ({
  accounts: SEED_ACCOUNTS,
  transactions: seedTransactions(),
  budgets: SEED_BUDGETS,
  categories: SEED_CATEGORIES,
  baseCurrency: "USD",

  addTransaction: (input) => {
    const txn: Transaction = { ...input, id: makeId("txn") };
    set((state) => ({
      transactions: [...state.transactions, txn],
      accounts: state.accounts.map((acc) => {
        if (acc.id !== txn.accountId) return acc;
        // Convert the txn amount into the account's currency before applying.
        const delta = convert(txn.amount, txn.currency, acc.currency);
        const signed = txn.kind === "income" ? delta : -delta;
        return { ...acc, balance: acc.balance + signed };
      }),
    }));
    return txn;
  },

  createAccount: (input) => {
    const account: Account = { ...input, id: makeId("acc") };
    set((state) => ({ accounts: [...state.accounts, account] }));
    return account;
  },

  setBudget: (input) => {
    // Upsert by category: replace an existing category budget if present.
    const existing = useFinanceStore
      .getState()
      .budgets.find((b) => b.category === input.category);
    const budget: Budget = {
      ...input,
      id: existing ? existing.id : makeId("bud"),
    };
    set((state) => ({
      budgets: existing
        ? state.budgets.map((b) => (b.id === existing.id ? budget : b))
        : [...state.budgets, budget],
    }));
    return budget;
  },

  editBudget: (id, patch) => {
    const current = useFinanceStore.getState().budgets.find((b) => b.id === id);
    if (!current) return undefined;
    const updated: Budget = { ...current, ...patch, id: current.id };
    set((state) => ({
      budgets: state.budgets.map((b) => (b.id === id ? updated : b)),
    }));
    return updated;
  },

  deleteTransaction: (id) => {
    set((state) => {
      const txn = state.transactions.find((t) => t.id === id);
      if (!txn) return state;
      return {
        transactions: state.transactions.filter((t) => t.id !== id),
        accounts: state.accounts.map((acc) => {
          if (acc.id !== txn.accountId) return acc;
          // Reverse the original balance effect.
          const delta = convert(txn.amount, txn.currency, acc.currency);
          const signed = txn.kind === "income" ? -delta : delta;
          return { ...acc, balance: acc.balance + signed };
        }),
      };
    });
  },
}));

// ---------------------------------------------------------------------------
// Selector helpers — plain functions, NOT hooks. They read the current store
// state via getState() so they're safe to call outside React.
// ---------------------------------------------------------------------------

/** Total net worth, every account balance converted into the base currency. */
export function netWorthInBase(): number {
  const { accounts, baseCurrency } = useFinanceStore.getState();
  return accounts.reduce(
    (sum, acc) => sum + convert(acc.balance, acc.currency, baseCurrency),
    0,
  );
}

/**
 * Total spent in a category this calendar month (expenses only), summed in
 * the base currency so multi-currency transactions aggregate correctly.
 */
export function budgetSpent(category: string): number {
  const { transactions, baseCurrency } = useFinanceStore.getState();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  return transactions
    .filter((t) => {
      if (t.kind !== "expense" || t.category !== category) return false;
      const d = new Date(t.date);
      return d.getFullYear() === year && d.getMonth() === month;
    })
    .reduce((sum, t) => sum + convert(t.amount, t.currency, baseCurrency), 0);
}

/** The `n` most recent transactions, newest first (by date, then insertion). */
export function recentTransactions(n: number): Transaction[] {
  const { transactions } = useFinanceStore.getState();
  return [...transactions]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, n);
}

/**
 * The `n` biggest expenses, largest first. Income is excluded, and amounts are
 * compared in the base currency (so a €120 charge outranks a $100 one) while
 * each returned transaction keeps its own currency for display. Powers the
 * in-chat "Top expenses" table the agent commissions via `getTopExpenses`.
 */
export function topExpenses(n: number): Transaction[] {
  const { transactions, baseCurrency } = useFinanceStore.getState();
  return [...transactions]
    .filter((t) => t.kind === "expense")
    .sort(
      (a, b) =>
        convert(b.amount, b.currency, baseCurrency) -
        convert(a.amount, a.currency, baseCurrency),
    )
    .slice(0, n);
}

/** Look up an account by id. */
export function accountById(id: string): Account | undefined {
  return useFinanceStore.getState().accounts.find((acc) => acc.id === id);
}

/**
 * Total spend per category this calendar month, expenses only, summed in the
 * base currency. Sorted by total desc. Powers the in-chat spend-by-category
 * donut chart that the agent commissions via `getSpendByCategory`.
 */
export function spendByCategoryThisMonth(): Array<{
  category: string;
  icon: string;
  total: number;
}> {
  const { transactions, categories, baseCurrency } = useFinanceStore.getState();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const iconByCategory = new Map(categories.map((c) => [c.name, c.icon]));
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.kind !== "expense") continue;
    const d = new Date(t.date);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const prev = totals.get(t.category) ?? 0;
    totals.set(t.category, prev + convert(t.amount, t.currency, baseCurrency));
  }
  return [...totals.entries()]
    .map(([category, total]) => ({
      category,
      icon: iconByCategory.get(category) ?? "💳",
      total,
    }))
    .sort((a, b) => b.total - a.total);
}
