"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  FileText,
  ShieldCheck,
} from "lucide-react";
import type {
  ExpensePolicy,
  PolicyException,
  Transaction,
} from "@/app/api/v1/data";
import { Button } from "@/components/ui/button";
import { PolicyExceptionInline } from "@/components/policy-exception-inline";
import { useRecording } from "@/components/recording-context";
import { cn, formatCurrency } from "@/lib/utils";

// Same locally-declared result shape every exception-filing surface uses
// (transactions-list, policy-exception-inline/-modal).
type ExceptionResult = {
  ok: boolean;
  data?: PolicyException;
  error?: string;
};

interface PendingApprovalsChatProps {
  transactions: Transaction[];
  policies: ExpensePolicy[];
  onApprove: (id: string) => Promise<boolean>;
  onDeny: (id: string) => Promise<boolean>;
  openPolicyException: (args: {
    transactionId: string;
    code: string;
  }) => Promise<ExceptionResult>;
  finalizePolicyException: (args: {
    exceptionId: string;
  }) => Promise<ExceptionResult>;
}

/**
 * Chat-width pending-approvals queue. The dashboard's approval table
 * (TransactionsList) is a 4-column, ~550px layout — inside the ~375px chat
 * card its Actions column lands past the card edge, so the buttons render
 * but cannot be clicked. This stacks each charge as a card with labeled,
 * full-width actions instead.
 *
 * Behavioral parity with the dashboard table is deliberate and exact:
 * identical over-limit/cleared derivation, identical begin/endRecording
 * bracketing and logStep narration (the recording vignette pulses while a
 * demonstration is captured), and the same PolicyExceptionInline form for
 * filing exceptions — so an officer can demonstrate the unlock inside the chat
 * exactly as they can on the dashboard.
 */
export function PendingApprovalsChat({
  transactions,
  policies,
  onApprove,
  onDeny,
  openPolicyException,
  finalizePolicyException,
}: PendingApprovalsChatProps) {
  const { beginRecording, endRecording, logStep } = useRecording();
  const [exceptionTxnId, setExceptionTxnId] = useState<string | null>(null);

  const statusOf = (transaction: Transaction) => {
    const policy = policies.find((p) => p.id === transaction.policyId);
    const policyOver =
      !!policy && policy.spent + Math.abs(transaction.amount) > policy.limit;
    return {
      overLimit: policyOver && !transaction.activeExceptionId,
      cleared: policyOver && !!transaction.activeExceptionId,
    };
  };

  // Mirrors TransactionsList.handleApprove: narrate only when the server
  // mutation took effect (a blocked over-limit approve is a no-op and must
  // never be narrated as an approval).
  const handleApprove = async (id: string): Promise<void> => {
    const ok = await onApprove(id);
    if (!ok) return;
    beginRecording();
    logStep("Approved the charge");
    endRecording();
  };

  const handleDeny = async (id: string): Promise<void> => {
    const ok = await onDeny(id);
    if (!ok) return;
    beginRecording();
    endRecording();
  };

  if (!transactions.length) {
    return (
      <p className="text-sm text-ink-muted">
        No transactions are pending approval.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="pending-approvals-chat">
      {transactions.map((transaction) => {
        const isIncome = transaction.amount > 0;
        const { overLimit, cleared } = statusOf(transaction);
        const isExpanded = exceptionTxnId === transaction.id;
        return (
          <div
            key={transaction.id}
            className="space-y-3 rounded-xl border border-hairline/70 bg-surface-muted/40 p-3"
          >
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
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold leading-tight text-ink">
                  {transaction.title}
                </p>
                <p className="text-xs leading-tight text-ink-muted">
                  {transaction.date}
                </p>
              </div>
              <p
                className={cn(
                  "whitespace-nowrap font-semibold tabular-nums",
                  isIncome ? "text-positive" : "text-negative",
                )}
              >
                {isIncome ? "+" : ""}
                {formatCurrency(transaction.amount)}
              </p>
            </div>

            {overLimit ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-negative-soft px-2.5 py-1 text-xs font-medium text-negative ring-1 ring-inset ring-negative/30">
                <AlertTriangle className="h-3.5 w-3.5" />
                Over limit — file a policy exception to approve
              </span>
            ) : cleared ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-positive-soft px-2.5 py-1 text-xs font-medium text-positive ring-1 ring-inset ring-positive/30">
                <ShieldCheck className="h-3.5 w-3.5" />
                Cleared
              </span>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={overLimit}
                onClick={() => void handleApprove(transaction.id)}
                className="rounded-full border-transparent bg-positive-soft text-positive hover:bg-positive-soft hover:brightness-95 disabled:opacity-40"
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleDeny(transaction.id)}
                className="rounded-full border-transparent bg-negative-soft text-negative hover:bg-negative-soft hover:brightness-95"
              >
                Deny
              </Button>
              {overLimit && !isExpanded && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    logStep("Opened the exception form");
                    setExceptionTxnId(transaction.id);
                  }}
                  className="rounded-full bg-surface text-ink-muted hover:bg-surface-muted"
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  File exception
                </Button>
              )}
            </div>

            {isExpanded && (
              <PolicyExceptionInline
                transactionId={transaction.id}
                openPolicyException={openPolicyException}
                finalizePolicyException={finalizePolicyException}
                onFiled={() => setExceptionTxnId(null)}
                onCancel={() => setExceptionTxnId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default PendingApprovalsChat;
