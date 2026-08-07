/**
 * CopilotKit transaction tools for the finance demo.
 *
 * `<TransactionTools/>` registers `addTransaction` as a **human-in-the-loop**
 * tool: when the agent calls it, we render the shared `<ApprovalCard>` and wait
 * for the user. Approving resolves the account, mutates the store, and reports
 * success back to the agent; cancelling reports a cancellation; editing tells
 * the agent the draft needs changes.
 *
 * SDK API used (node_modules/@copilotkit/react-native -> react-core v2):
 *
 *   useHumanInTheLoop<T>(tool: ReactHumanInTheLoop<T>, deps?): void
 *   where ReactHumanInTheLoop<T> =
 *     Omit<FrontendTool<T>, "handler"> & {
 *       render: React.ComponentType<
 *         | { name; description; args: Partial<T>; status: InProgress; result: undefined; respond: undefined }
 *         | { name; description; args: T;          status: Executing;  result: undefined; respond: (result: unknown) => Promise<void> }
 *         | { name; description; args: T;          status: Complete;   result: string;    respond: undefined }
 *       >;
 *     }
 *   FrontendTool<T> = { name; description?; parameters?: StandardSchemaV1<any,T>; followUp?; agentId?; available? }
 *
 * Notes on the shape we rely on:
 *  - HITL tools carry their own `render`; the SDK shows it inline in chat, so we
 *    do NOT also need `useRenderTool` here (that hook is for plain frontend
 *    tools that want inline rendering).
 *  - `respond(result)` is present (a function) ONLY while the tool call is in
 *    the Executing state — i.e. when the agent is actually waiting on the user.
 *    We narrow purely on that discriminant (and on `result` for the completed
 *    state) so the file depends only on `@copilotkit/react-native` + `zod`
 *    (zod is the SDK's declared peer dependency) — no `@copilotkit/core` import
 *    is needed just to read the status enum.
 *  - The render prop component type is taken directly from the SDK's exported
 *    `ReactHumanInTheLoop<T>["render"]`, so we implement the real signature.
 */

import { useState } from "react";
import { z } from "zod";
import { useHumanInTheLoop } from "@copilotkit/react-native";
import type { ReactHumanInTheLoop } from "@copilotkit/react-native";
import { ApprovalCard } from "./ApprovalCard";
import type { ApprovalRow } from "./ApprovalCard";
import { TOOLS } from "./contracts";
import type { AddTransactionArgs } from "./contracts";
import { useFinanceStore } from "../store/financeStore";
import { formatCurrency } from "../lib/currency";
import type { Account, CurrencyCode, TxnKind } from "../types";

/**
 * `AddTransactionArgs` is declared as an `interface` in the (read-only)
 * contracts file, and TS interfaces do not satisfy the `Record<string,
 * unknown>` constraint the SDK hooks place on their generic. A mapped-type
 * alias is structurally identical but DOES satisfy that constraint (object
 * type aliases get an inferred index signature, interfaces do not). We map
 * over `keyof` so this stays in lock-step with the contract automatically.
 */
type AddTransactionToolArgs = {
  [K in keyof AddTransactionArgs]: AddTransactionArgs[K];
};

/** ISO yyyy-mm-dd for "today" in local time (matches the store's default). */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolve the target account from the agent-supplied args. Prefers an explicit
 * `accountId`; otherwise matches `accountName` case-insensitively (exact match
 * first, then a forgiving substring match like "amex" -> "Amex").
 */
function resolveAccount(
  args: Pick<AddTransactionArgs, "accountId" | "accountName">,
): Account | undefined {
  const { accounts } = useFinanceStore.getState();
  if (args.accountId) {
    const byId = accounts.find((a) => a.id === args.accountId);
    if (byId) return byId;
  }
  const name = args.accountName?.trim().toLowerCase();
  if (name) {
    const exact = accounts.find((a) => a.name.toLowerCase() === name);
    if (exact) return exact;
    return accounts.find(
      (a) =>
        a.name.toLowerCase().includes(name) ||
        name.includes(a.name.toLowerCase()),
    );
  }
  return undefined;
}

/**
 * Derive the "<Account> balance now <amount>" line from a completed tool
 * result. Used as a fallback when a card is re-rendered from history (where the
 * live approve-time local state is gone) but the tool result is present.
 */
function balanceDetailFromResult(result: string | undefined): string | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as {
      ok?: boolean;
      account?: { name?: string; balance?: number; currency?: CurrencyCode };
    };
    const acct = parsed.account;
    if (parsed.ok && acct?.name && typeof acct.balance === "number") {
      return `${acct.name} balance now ${formatCurrency(
        acct.balance,
        acct.currency ?? "USD",
      )}`;
    }
  } catch {
    // Non-JSON or unexpected shape — no balance detail to show.
  }
  return null;
}

/** Pick an emoji for the category from the store's category list. */
function categoryEmoji(category: string): string {
  const { categories } = useFinanceStore.getState();
  const match = categories.find(
    (c) => c.name.toLowerCase() === category.trim().toLowerCase(),
  );
  return match?.icon ?? "💸";
}

/** Zod schema mirroring AddTransactionArgs (the JSON the LLM emits). */
const currencyEnum = z.enum([
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "PHP",
  "INR",
  "AUD",
  "CAD",
]);

const addTransactionSchema = z.object({
  accountId: z
    .string()
    .optional()
    .describe("Target account id when known (preferred)."),
  accountName: z
    .string()
    .optional()
    .describe('Human account name like "Amex" when the id is unknown.'),
  kind: z.enum(["expense", "income"]).describe("Transaction direction."),
  amount: z.number().positive().describe("Positive amount in `currency`."),
  currency: currencyEnum.describe("ISO currency code of the amount."),
  category: z.string().describe('Category name, e.g. "Groceries".'),
  merchant: z.string().describe("Merchant or payee name."),
  note: z.string().optional().describe("Optional free-text note."),
  date: z
    .string()
    .optional()
    .describe("ISO yyyy-mm-dd; defaults to today when omitted."),
});

/**
 * The render component type, taken straight from the SDK's exported
 * `ReactHumanInTheLoop<T>` so we implement the real discriminated-union
 * signature (over InProgress / Executing / Complete) without re-deriving it.
 */
type AddTransactionRender =
  ReactHumanInTheLoop<AddTransactionToolArgs>["render"];

/** Local UI resolution state for a single approval card instance. */
type Decision = "pending" | "approved" | "cancelled";

/**
 * The approval UI for one `addTransaction` tool call. The SDK hands us the live
 * tool-call props; `respond` is a function ONLY while the agent is waiting
 * (Executing), so we treat "can we act?" as `typeof respond === 'function'`.
 * The user may Approve / Edit / Cancel; we then `respond(...)` to resume.
 */
const AddTransactionApproval: AddTransactionRender = (props) => {
  const { args, respond, result } = props;
  const [decision, setDecision] = useState<Decision>("pending");
  // Account label resolved at approve-time, surfaced in the card afterwards.
  const [resolvedAccountLabel, setResolvedAccountLabel] = useState<
    string | null
  >(null);
  // Success line ("<Account> balance now <amount>") shown the instant the user
  // approves — immediate, local confirmation that does NOT wait on the agent.
  const [successDetail, setSuccessDetail] = useState<string | null>(null);

  const kind = (args.kind as TxnKind) ?? "expense";
  const amount = typeof args.amount === "number" ? args.amount : 0;
  const currency = (args.currency as CurrencyCode) ?? "USD";
  const category = args.category ?? "";
  const merchant = args.merchant ?? "";
  const date = args.date ?? todayISO();

  // `respond` is defined only in the Executing arm (agent awaiting the user);
  // `result` (a string) is present only once the call has completed.
  const canRespond = typeof respond === "function";
  // In-progress = args still streaming, nothing to act on and not yet done.
  const streaming = !canRespond && result === undefined;

  // Account row: prefer the resolved label (post-approve), else echo the
  // agent's hint (id or name) so the user sees what will be charged.
  const accountHint =
    resolvedAccountLabel ??
    args.accountName ??
    (args.accountId
      ? (useFinanceStore
          .getState()
          .accounts.find((a) => a.id === args.accountId)?.name ??
        args.accountId)
      : "Not specified");

  const rows: ApprovalRow[] = [
    { label: "Type", value: kind === "income" ? "Income" : "Expense" },
    { label: "Amount", value: formatCurrency(amount, currency) },
    { label: "Merchant", value: merchant || "—" },
    { label: "Category", value: category || "—" },
    { label: "Account", value: accountHint },
    { label: "Date", value: date },
  ];
  if (args.note) {
    rows.push({ label: "Note", value: args.note });
  }

  const handleApprove = async () => {
    // `respond` exists only while the agent is waiting (Executing). Guarding
    // here also narrows it to a callable for the rest of this closure.
    if (!respond) return;
    const account = resolveAccount(args);
    if (!account) {
      // Couldn't resolve — tell the agent so it can re-ask with a valid account.
      setDecision("cancelled");
      await respond({
        ok: false,
        status: "account_not_found",
        message:
          "Could not resolve the account from accountId/accountName. " +
          "Ask the user which account to use, then call addTransaction again.",
        provided: { accountId: args.accountId, accountName: args.accountName },
      });
      return;
    }

    const txn = useFinanceStore.getState().addTransaction({
      accountId: account.id,
      kind,
      amount,
      currency,
      category,
      merchant,
      note: args.note,
      date,
      source: "chat",
    });

    // Re-read the account so we can confirm the *new* balance immediately —
    // `account` above was captured before the mutation.
    const updated =
      useFinanceStore.getState().accounts.find((a) => a.id === account.id) ??
      account;
    const newBalance = formatCurrency(updated.balance, updated.currency);

    setResolvedAccountLabel(updated.name);
    setSuccessDetail(`${updated.name} balance now ${newBalance}`);
    setDecision("approved");
    await respond({
      ok: true,
      status: "added",
      transaction: txn,
      account: {
        id: updated.id,
        name: updated.name,
        balance: updated.balance,
        currency: updated.currency,
      },
      message: `Added ${formatCurrency(amount, currency)} ${
        kind === "income" ? "to" : "from"
      } ${updated.name} (${merchant || category}). ${
        updated.name
      } balance is now ${newBalance}.`,
    });
  };

  const handleCancel = async () => {
    if (!respond) return;
    setDecision("cancelled");
    await respond({
      ok: false,
      status: "cancelled",
      message: "User cancelled the transaction. Do not add it.",
    });
  };

  // Optional Edit: signals the agent the draft needs changes, without writing.
  const handleEdit = async () => {
    if (!respond) return;
    setDecision("cancelled");
    await respond({
      ok: false,
      status: "needs_changes",
      message:
        "User wants to edit this transaction before saving. Ask what they " +
        "would like to change, then call addTransaction again with the " +
        "corrected details.",
      draft: {
        kind,
        amount,
        currency,
        category,
        merchant,
        date,
        note: args.note,
      },
    });
  };

  // Card status: once the call has completed (result present), or we recorded a
  // local decision, lock the card into the resolved banner.
  const cardStatus: "pending" | "approved" | "cancelled" =
    decision !== "pending"
      ? decision
      : result !== undefined
        ? "approved"
        : "pending";

  // Success confirmation: the live approve-time line, or — when the card is
  // re-rendered from history — derived from the completed tool result.
  const detail =
    cardStatus === "approved"
      ? (successDetail ?? balanceDetailFromResult(result))
      : null;

  return (
    <ApprovalCard
      emoji={categoryEmoji(category)}
      title={streaming ? "Preparing transaction…" : "Add transaction"}
      rows={rows}
      approveLabel={kind === "income" ? "Add income" : "Add expense"}
      onApprove={handleApprove}
      onEdit={handleEdit}
      onCancel={handleCancel}
      status={cardStatus}
      resolvedLabel={
        cardStatus === "approved"
          ? kind === "income"
            ? "Added income"
            : "Added expense"
          : undefined
      }
      resolvedDetail={detail ?? undefined}
    />
  );
};

/**
 * Registers the `addTransaction` human-in-the-loop tool. Renders nothing
 * itself — mount it once under the CopilotKitProvider, alongside
 * `<FinanceReadTools/>`.
 */
export function TransactionTools(): null {
  useHumanInTheLoop<AddTransactionToolArgs>({
    name: TOOLS.addTransaction,
    description:
      "Add a financial transaction (expense or income) to an account. This " +
      "requires explicit user approval: the user is shown a confirmation card " +
      "and may approve, cancel, or request changes. Identify the account by " +
      'accountId when known, otherwise by accountName (e.g. "Amex"). Amount ' +
      "must be positive; use `kind` for the direction.",
    parameters: addTransactionSchema,
    render: AddTransactionApproval,
  });

  return null;
}
