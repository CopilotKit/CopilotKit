"use client";

import { DollarSign, Check, X } from "lucide-react";
import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { Button } from "@/components/ui/button";

type InvoiceRow = {
  number: string;
  client: string;
  amount: number;
  dueDate: string;
};

type Args = {
  invoices: InvoiceRow[];
  totalAmount: number;
  action: string;
};

type Props =
  | {
      status: ToolCallStatus.InProgress;
      args: Partial<Args>;
      respond: undefined;
      result: undefined;
    }
  | {
      status: ToolCallStatus.Executing;
      args: Args;
      respond: (result: unknown) => Promise<void>;
      result: undefined;
    }
  | {
      status: ToolCallStatus.Complete;
      args: Args;
      respond: undefined;
      result: string;
    };

export function InvoiceApprovalCard(props: Props) {
  const { status, args } = props;

  if (status === ToolCallStatus.InProgress) {
    return (
      <div className="my-2 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-border bg-card p-5 duration-300 ease-out">
        <div className="flex items-center gap-2 text-muted-foreground">
          <DollarSign className="h-4 w-4 animate-pulse" />
          <span className="text-sm">Reviewing invoices...</span>
        </div>
      </div>
    );
  }

  const { invoices, totalAmount, action } = args as Args;
  const isComplete = status === ToolCallStatus.Complete;
  const result = isComplete ? (props as { result: string }).result : null;
  const wasApproved = result?.includes("approved");

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(n);

  return (
    <div
      className={`my-2 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border bg-card p-5 duration-300 ease-out ${isComplete ? "border-border/50 opacity-80" : "border-border"}`}
    >
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
          <DollarSign className="h-4 w-4 text-warning" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            Payment Approval Required
          </p>
          <p className="text-xs text-muted-foreground">{action}</p>
        </div>
      </div>

      {/* Invoice table */}
      <div className="mb-4 rounded-xl border border-border/50 bg-muted/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Invoice</th>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
              <th className="px-3 py-2 font-medium text-right">Due</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.number} className="border-b border-border/30">
                <td className="px-3 py-2 font-mono text-foreground">
                  {inv.number}
                </td>
                <td className="px-3 py-2 text-foreground">{inv.client}</td>
                <td className="px-3 py-2 text-right font-medium text-foreground">
                  {formatCurrency(inv.amount)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {inv.dueDate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Total
          </span>
          <span className="text-sm font-bold text-foreground">
            {formatCurrency(totalAmount)}
          </span>
        </div>
      </div>

      {/* Status badge (complete state) */}
      {isComplete && (
        <div
          className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${wasApproved ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
        >
          {wasApproved ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          {wasApproved ? "Payment Approved" : "Payment Rejected"}
        </div>
      )}

      {/* Action buttons (executing state only) */}
      {status === ToolCallStatus.Executing && (
        <div className="flex gap-2">
          <Button
            onClick={() =>
              props.respond({
                approved: true,
                message: `Payment approved for ${invoices.length} invoice(s) totaling ${formatCurrency(totalAmount)}`,
              })
            }
            className="flex-1 bg-emerald-600 text-white hover:bg-emerald-500"
          >
            Approve Payment
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              props.respond({
                approved: false,
                message: "Payment rejected by user",
              })
            }
            className="flex-1"
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
