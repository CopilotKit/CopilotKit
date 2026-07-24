/**
 * `<FinanceCopilot/>` — the single mount point for every CopilotKit tool the
 * finance app exposes to the agent.
 *
 * Each child registers its tools via the SDK hooks (`useFrontendTool` /
 * `useHumanInTheLoop`) and renders `null` (or, for `<ReceiptTools/>`, a context
 * provider wrapping its children). Mounting them together here means the app
 * shell only has to render `<FinanceCopilot/>` once, inside
 * `<CopilotKitProvider>`, to wire up the whole tool surface:
 *
 *   • <FinanceReadTools/>  — read-only grounding tools (getAccounts, getBudgets,
 *                            getRecentTransactions, getTopExpenses,
 *                            getSpendByCategory).
 *   • <TransactionTools/>  — addTransaction (human-in-the-loop).
 *   • <AccountTools/>      — createAccount (human-in-the-loop).
 *   • <BudgetTools/>       — setBudget + editBudget (human-in-the-loop).
 *   • <ReceiptTools/>      — parseReceipt frontend tool + the receipt-capture
 *                            context (consumed by the chat's 📎 attach button
 *                            via `useReceiptCapture()`).
 *
 * `<ReceiptTools/>` provides the `ReceiptCaptureContext` that the chat's 📎
 * button reads via `useReceiptCapture()`, so it must be an ANCESTOR of any
 * consumer. `<FinanceCopilot/>` therefore wraps the app body as its `children`:
 * pass the app inside it and the context reaches every screen. The other four
 * tool components render `null`, so nesting them here is purely structural — it
 * adds no visible UI and keeps every registration under one provider subtree.
 */

import type { ReactNode } from "react";
import { FinanceReadTools } from "./reads";
import { TransactionTools } from "./transactions";
import { AccountTools } from "./accounts";
import { BudgetTools } from "./budgets";
import { ReceiptTools } from "./receipt";

export interface FinanceCopilotProps {
  /** App content rendered within the receipt-capture context. */
  children?: ReactNode;
}

/**
 * Mounts all five CopilotKit tool components together and exposes the
 * receipt-capture context to `children`. Mount once, inside
 * `<CopilotKitProvider>`, wrapping the app body.
 */
export function FinanceCopilot({
  children,
}: FinanceCopilotProps): React.ReactElement {
  return (
    <ReceiptTools>
      <FinanceReadTools />
      <TransactionTools />
      <AccountTools />
      <BudgetTools />
      {children}
    </ReceiptTools>
  );
}
