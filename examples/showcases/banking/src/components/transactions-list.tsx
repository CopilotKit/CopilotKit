"use client";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  MessageSquare,
  X,
} from "lucide-react";
import type { ExpensePolicy, PolicyException, Transaction } from "@/app/api/v1/data";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useRecordUserActionInCurrentThread } from "@/lib/record-user-action";
import { PolicyExceptionModal } from "@/components/policy-exception-modal";

type ExceptionResult = {
  ok: boolean;
  data?: PolicyException;
  error?: string;
};

interface ApprovalInterfaceProps {
  // Return true iff the server mutation succeeded, so the caller only records
  // the human action when it actually took effect (a blocked over-limit
  // approval must not be recorded as an approval).
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
  // Called unconditionally at the top so hook order is stable. When this
  // component is rendered compact / read-only (without showApprovalInterface)
  // the recorder is simply never invoked.
  const recordUserAction = useRecordUserActionInCurrentThread();
  const [exceptionTxnId, setExceptionTxnId] = useState<string | null>(null);

  return (
    <div
      className={cn(
        "overflow-hidden",
        compact ? "text-sm" : "text-base",
      )}
    >
      {transactions.map((transaction) => {
        // Over-limit is derived on the CLIENT from already-loaded data: a
        // pending txn whose policy would be pushed past its limit by this
        // amount, and which has no exception linked yet. Once a justifying
        // exception is finalized server-side, `activeExceptionId` is set and
        // this clears. (A non-justifying exception also clears the badge but
        // the approve will re-block server-side — acceptable for the demo.)
        const policy = policies.find((p) => p.id === transaction.policyId);
        const policyOver =
          !!policy &&
          policy.spent + Math.abs(transaction.amount) > policy.limit;
        const overLimit = policyOver && !transaction.activeExceptionId;

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
                    className={cn(
                      "text-ink",
                      compact ? "text-xs" : "text-sm",
                    )}
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
            {showApprovalInterface && transaction.status === "pending" && (
              <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface p-4">
                {overLimit && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-1.5 rounded-full bg-negative-soft px-2.5 py-1 text-xs font-medium text-negative ring-1 ring-inset ring-negative/30">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Over policy limit
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExceptionTxnId(transaction.id)}
                    >
                      File policy exception
                    </Button>
                  </div>
                )}
                <div className="flex items-center justify-center space-x-4">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={async () => {
                      const ok =
                        (await approvalInterfaceProps?.onApprove?.(
                          transaction.id,
                        )) ?? false;
                      if (!ok) return;
                      recordUserAction({
                        title: "transaction.approved",
                        description:
                          "User approved a pending transaction from the transactions view.",
                        previousData: { status: "pending" },
                        newData: { status: "approved" },
                        metadata: { transactionId: transaction.id },
                      }).catch(console.error);
                    }}
                    aria-label="Approve"
                    className="h-12 w-12 rounded-full border-transparent bg-positive-soft text-positive hover:bg-positive-soft hover:text-positive hover:brightness-95 dark:hover:brightness-110"
                  >
                    <Check className="h-6 w-6" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={async () => {
                      const ok =
                        (await approvalInterfaceProps?.onDeny?.(
                          transaction.id,
                        )) ?? false;
                      if (!ok) return;
                      recordUserAction({
                        title: "transaction.denied",
                        description:
                          "User denied a pending transaction from the transactions view.",
                        previousData: { status: "pending" },
                        newData: { status: "denied" },
                        metadata: { transactionId: transaction.id },
                      }).catch(console.error);
                    }}
                    aria-label="Deny"
                    className="h-12 w-12 rounded-full border-transparent bg-negative-soft text-negative hover:bg-negative-soft hover:text-negative hover:brightness-95 dark:hover:brightness-110"
                  >
                    <X className="h-6 w-6" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {exceptionTxnId && openPolicyException && finalizePolicyException && (
        <PolicyExceptionModal
          open
          transactionId={exceptionTxnId}
          openPolicyException={openPolicyException}
          finalizePolicyException={finalizePolicyException}
          onOpenChange={(o) => {
            if (!o) setExceptionTxnId(null);
          }}
        />
      )}
    </div>
  );
}
