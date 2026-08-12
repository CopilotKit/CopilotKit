"use client";

import { Fragment, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  FileText,
  MessageSquare,
  MoreHorizontal,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  ExpensePolicy,
  PolicyException,
  Transaction,
} from "@/app/api/v1/data";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRecording } from "@/components/recording-context";
import { PolicyExceptionInline } from "@/components/policy-exception-inline";

type ExceptionResult = {
  ok: boolean;
  data?: PolicyException;
  error?: string;
};

interface ApprovalInterfaceProps {
  // Return true iff the server mutation succeeded, so the caller only narrates
  // the human action when it actually took effect (a blocked over-limit
  // approval must not be narrated as an approval).
  onApprove?: (transactionId: string) => Promise<boolean> | boolean;
  onDeny?: (transactionId: string) => Promise<boolean> | boolean;
}

interface TransactionsListProps {
  transactions: Transaction[];
  compact?: boolean;
  showApprovalInterface?: boolean;
  approvalInterfaceProps?: ApprovalInterfaceProps;
  // Expense policies, used to derive the over-limit indicator on the client
  // (no server-only store import). Only needed when showApprovalInterface.
  policies?: ExpensePolicy[];
  // REST callers, threaded in from the page's `useCreditCards` hook to avoid
  // duplicate polling. Passed straight to the PolicyExceptionModal. Only
  // needed when the approval interface is shown.
  openPolicyException?: (args: {
    transactionId: string;
    code: string;
  }) => Promise<ExceptionResult>;
  finalizePolicyException?: (args: {
    exceptionId: string;
  }) => Promise<ExceptionResult>;
}

export function TransactionsList({
  transactions,
  compact = false,
  showApprovalInterface = false,
  approvalInterfaceProps = {},
  policies = [],
  openPolicyException,
  finalizePolicyException,
}: TransactionsListProps) {
  // Bracket each demonstrated action so the canvas recording vignette pulses
  // while it is captured. `logStep` narrates each click into the recorder feed
  // while recording.
  const { beginRecording, endRecording, logStep } = useRecording();
  const [exceptionTxnId, setExceptionTxnId] = useState<string | null>(null);

  // Approve a charge from the queue. Only narrates the action when the server
  // mutation actually took effect (a blocked over-limit approve is a no-op and
  // must never be narrated as an approval).
  const handleApprove = async (id: string): Promise<void> => {
    const ok = (await approvalInterfaceProps?.onApprove?.(id)) ?? false;
    if (!ok) return;
    beginRecording();
    logStep("Approved the charge");
    endRecording();
  };

  const handleDeny = async (id: string): Promise<void> => {
    const ok = (await approvalInterfaceProps?.onDeny?.(id)) ?? false;
    if (!ok) return;
    beginRecording();
    endRecording();
  };

  // Derive a row's policy status from already-loaded data (no server import):
  //  - overLimit: would push the policy past its limit and has no exception yet,
  //  - cleared:   over its limit but a justifying exception is now linked.
  // Once a justifying exception is finalized server-side `activeExceptionId` is
  // set, so the row flips overLimit → cleared and Approve unlocks.
  const statusOf = (transaction: Transaction) => {
    const policy = policies.find((p) => p.id === transaction.policyId);
    const policyOver =
      !!policy && policy.spent + Math.abs(transaction.amount) > policy.limit;
    return {
      overLimit: policyOver && !transaction.activeExceptionId,
      cleared: policyOver && !!transaction.activeExceptionId,
    };
  };

  // ── Approval queue ─────────────────────────────────────────────────────────
  // A scannable table (Merchant · Amount · Policy · Actions) instead of a
  // center-stacked card per row: columns let the eye compare amounts/status down
  // the list. Each row's actions are check / x icon buttons with a "more
  // actions" overflow menu for File policy exception. Approve is gated while the
  // charge is over its limit (it would only be rejected server-side until a
  // justifying exception is filed), which makes the policy gate legible.
  if (showApprovalInterface) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs font-medium uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2.5 text-left font-medium">Merchant</th>
              <th className="px-3 py-2.5 text-right font-medium">Amount</th>
              <th className="px-3 py-2.5 text-left font-medium">Policy</th>
              <th className="px-3 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => {
              const isIncome = transaction.amount > 0;
              const { overLimit, cleared } = statusOf(transaction);
              const isExpanded = exceptionTxnId === transaction.id;
              const canFileException =
                overLimit && openPolicyException && finalizePolicyException;
              return (
                <Fragment key={transaction.id}>
                  <tr className="border-b border-hairline/60 transition-colors hover:bg-surface-muted">
                    {/* Merchant */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex h-9 w-9 flex-none items-center justify-center rounded-full",
                            isIncome
                              ? "bg-positive-soft text-positive"
                              : "bg-negative-soft text-negative",
                          )}
                        >
                          {isIncome ? (
                            <ArrowUpRight className="h-4 w-4" />
                          ) : (
                            <ArrowDownRight className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold leading-tight text-ink">
                            {transaction.title}
                          </p>
                          <p className="text-xs leading-tight text-ink-muted">
                            {transaction.date}
                          </p>
                        </div>
                      </div>
                    </td>
                    {/* Amount */}
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums",
                        isIncome ? "text-positive" : "text-negative",
                      )}
                    >
                      {isIncome ? "+" : ""}
                      {formatCurrency(transaction.amount)}
                    </td>
                    {/* Policy status */}
                    <td className="px-3 py-3">
                      {overLimit ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-negative-soft px-2.5 py-1 text-xs font-medium text-negative ring-1 ring-inset ring-negative/30">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Over limit
                        </span>
                      ) : cleared ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-positive-soft px-2.5 py-1 text-xs font-medium text-positive ring-1 ring-inset ring-positive/30">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Cleared
                        </span>
                      ) : (
                        <span className="text-xs text-ink-muted">
                          Within limit
                        </span>
                      )}
                    </td>
                    {/* Actions: check / x + a more-actions overflow menu */}
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <span
                          title={
                            overLimit
                              ? "File a policy exception to approve"
                              : undefined
                          }
                        >
                          <Button
                            variant="outline"
                            size="icon"
                            disabled={overLimit}
                            onClick={() => void handleApprove(transaction.id)}
                            aria-label="Approve"
                            className="h-9 w-9 rounded-full border-transparent bg-positive-soft text-positive hover:bg-positive-soft hover:text-positive hover:brightness-95 disabled:opacity-40 dark:hover:brightness-110"
                          >
                            <Check className="h-5 w-5" />
                          </Button>
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => void handleDeny(transaction.id)}
                          aria-label="Deny"
                          className="h-9 w-9 rounded-full border-transparent bg-negative-soft text-negative hover:bg-negative-soft hover:text-negative hover:brightness-95 dark:hover:brightness-110"
                        >
                          <X className="h-5 w-5" />
                        </Button>
                        {canFileException ? (
                          // modal={false} so opening the menu does NOT engage
                          // Radix's scroll-lock (react-remove-scroll), which
                          // otherwise compensates for the scrollbar and reflows
                          // the table — squeezing the columns and clipping this
                          // Actions cell. A row action menu has no need to be
                          // modal; it still dismisses on outside-click/scroll.
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="More actions"
                                className="h-9 w-9 rounded-full text-ink-muted hover:bg-surface-muted"
                              >
                                <MoreHorizontal className="h-5 w-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              // The CopilotKit chat sidebar is z-index:1200; the
                              // menu portals to <body> at z-50, so it renders
                              // BEHIND the panel in the chat. Lift it above the panel.
                              className="z-[1300]"
                            >
                              <DropdownMenuItem
                                onClick={() => {
                                  logStep("Opened the exception form");
                                  setExceptionTxnId(transaction.id);
                                }}
                              >
                                <FileText className="mr-2 h-4 w-4" />
                                File policy exception
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </td>
                  </tr>

                  {/* Inline exception form — expands directly under its row. */}
                  {isExpanded &&
                    openPolicyException &&
                    finalizePolicyException && (
                      <tr className="border-b border-hairline/60">
                        <td colSpan={4} className="px-3 pb-3">
                          <PolicyExceptionInline
                            transactionId={transaction.id}
                            openPolicyException={openPolicyException}
                            finalizePolicyException={finalizePolicyException}
                            onFiled={() => setExceptionTxnId(null)}
                            onCancel={() => setExceptionTxnId(null)}
                          />
                        </td>
                      </tr>
                    )}

                  {/* Note */}
                  {transaction.note && (
                    <tr className="border-b border-hairline/60">
                      <td colSpan={4} className="px-3 pb-3">
                        <div className="flex items-start rounded-xl bg-surface-muted p-3">
                          <MessageSquare className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0 text-ink-muted" />
                          <div className="flex-1">
                            <p className="text-sm text-ink">
                              {transaction.note.content}
                            </p>
                            <p className="mt-1 text-xs text-ink-muted">
                              {transaction.note.date}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Read-only list ─────────────────────────────────────────────────────────
  // The original compact row layout, used by the chat showTransactions card and
  // the dashboard overview / all / income / expenses tabs (no approval UI).
  return (
    <div className={cn("overflow-hidden", compact ? "text-sm" : "text-base")}>
      {transactions.map((transaction) => {
        const isIncome = transaction.amount > 0;
        return (
          <div key={transaction.id}>
            <div
              className={cn(
                "flex items-center rounded-2xl transition-colors hover:bg-surface-muted",
                compact ? "gap-3 p-2.5" : "gap-4 p-3",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center rounded-full",
                  isIncome
                    ? "bg-positive-soft text-positive"
                    : "bg-negative-soft text-negative",
                  compact ? "h-9 w-9" : "h-11 w-11",
                )}
              >
                {isIncome ? (
                  <ArrowUpRight
                    className={cn(compact ? "h-4 w-4" : "h-5 w-5")}
                  />
                ) : (
                  <ArrowDownRight
                    className={cn(compact ? "h-4 w-4" : "h-5 w-5")}
                  />
                )}
              </div>
              <div className="flex-1 space-y-0.5">
                <p
                  className={cn(
                    "font-semibold leading-tight text-ink",
                    compact ? "text-xs" : "text-sm",
                  )}
                >
                  {transaction.title}
                </p>
                <p
                  className={cn(
                    "leading-tight text-ink-muted",
                    compact ? "text-[0.7rem]" : "text-xs",
                  )}
                >
                  {isIncome ? "Incoming" : "Outgoing"} · {transaction.date}
                </p>
              </div>
              <div
                className={cn(
                  "font-semibold tabular-nums",
                  isIncome ? "text-positive" : "text-negative",
                  compact ? "text-sm" : "text-base",
                )}
              >
                {isIncome ? "+" : ""}
                {formatCurrency(transaction.amount)}
              </div>
            </div>
            {transaction.note && (
              <div
                className={cn(
                  "mx-3 mb-2 flex items-start rounded-xl bg-surface-muted",
                  compact ? "p-2" : "p-3",
                )}
              >
                <MessageSquare
                  className={cn(
                    "mr-2 flex-shrink-0 text-ink-muted",
                    compact ? "h-3 w-3 mt-0.5" : "h-4 w-4 mt-0.5",
                  )}
                />
                <div className="flex-1">
                  <p
                    className={cn("text-ink", compact ? "text-xs" : "text-sm")}
                  >
                    {transaction.note.content}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-ink-muted",
                      compact ? "text-xs" : "text-sm",
                    )}
                  >
                    {transaction.note.date}
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
