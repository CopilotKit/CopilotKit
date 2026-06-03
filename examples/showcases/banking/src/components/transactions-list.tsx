"use client";

import {
  AlertTriangle,
  Check,
  MessageSquare,
  PlusCircle,
  Send,
  X,
} from "lucide-react";
import type { ExpensePolicy, PolicyException, Transaction } from "@/app/api/v1/data";
import { cn, formatCurrency } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
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
        "border rounded-lg overflow-hidden",
        compact ? "text-sm" : "text-base",
      )}
    >
      {transactions.map((transaction, index) => {
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

        return (
          <div key={transaction.id}>
            <div
              className={cn("flex items-center p-4", compact ? "p-3" : "p-4")}
            >
              <div
                className={cn(
                  "rounded-full flex items-center justify-center mr-4",
                  transaction.amount > 0 ? "bg-green-500" : "bg-red-500",
                  compact ? "w-6 h-6" : "w-8 h-8",
                )}
              >
                {transaction.amount > 0 ? (
                  <PlusCircle
                    className={cn(
                      "text-white",
                      compact ? "h-3 w-3" : "h-4 w-4",
                    )}
                  />
                ) : (
                  <Send
                    className={cn(
                      "text-white",
                      compact ? "h-3 w-3" : "h-4 w-4",
                    )}
                  />
                )}
              </div>
              <div className="flex-1 space-y-1">
                <p
                  className={cn(
                    "font-medium leading-tight",
                    compact ? "text-xs" : "text-sm",
                  )}
                >
                  {transaction.title}
                </p>
                <p
                  className={cn(
                    "text-neutral-500 dark:text-neutral-400 leading-tight",
                    compact ? "text-xs" : "text-sm",
                  )}
                >
                  {transaction.date}
                </p>
              </div>
              <div
                className={cn(
                  transaction.amount > 0 ? "text-green-500" : "text-red-500",
                  compact ? "text-sm" : "text-base",
                )}
              >
                {transaction.amount > 0 ? "+" : ""}
                {formatCurrency(transaction.amount)}
              </div>
            </div>
            {transaction.note && (
              <div
                className={cn(
                  "bg-neutral-100 dark:bg-neutral-800 p-3 flex items-start",
                  compact ? "p-2" : "p-3",
                )}
              >
                <MessageSquare
                  className={cn(
                    "text-neutral-500 dark:text-neutral-400 mr-2 flex-shrink-0",
                    compact ? "h-3 w-3 mt-0.5" : "h-4 w-4 mt-1",
                  )}
                />
                <div className="flex-1">
                  <p
                    className={cn(
                      "text-neutral-700 dark:text-neutral-300",
                      compact ? "text-xs" : "text-sm",
                    )}
                  >
                    {transaction.note.content}
                  </p>
                  <p
                    className={cn(
                      "text-neutral-500 dark:text-neutral-400 mt-1",
                      compact ? "text-xs" : "text-sm",
                    )}
                  >
                    {transaction.note.date}
                  </p>
                </div>
              </div>
            )}
            {showApprovalInterface && transaction.status === "pending" && (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-white p-4">
                {overLimit && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-900/40">
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
                    className="h-12 w-12 rounded-full bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:hover:text-green-300"
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
                    className="h-12 w-12 rounded-full bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
                  >
                    <X className="h-6 w-6" />
                  </Button>
                </div>
              </div>
            )}
            {index < transactions.length - 1 && <Separator className="my-0" />}
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
