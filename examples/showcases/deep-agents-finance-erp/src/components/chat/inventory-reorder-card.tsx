"use client";

import { Package, Check, SkipForward } from "lucide-react";
import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { Button } from "@/components/ui/button";

type ReorderItem = {
  sku: string;
  name: string;
  currentQty: number;
  reorderQty: number;
  unitCost: number;
};

type Args = {
  items: ReorderItem[];
  estimatedTotal: number;
  supplier?: string;
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

export function InventoryReorderCard(props: Props) {
  const { status, args } = props;

  if (status === ToolCallStatus.InProgress) {
    return (
      <div className="my-2 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-border bg-card p-5 duration-300 ease-out">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Package className="h-4 w-4 animate-pulse" />
          <span className="text-sm">Analyzing inventory levels...</span>
        </div>
      </div>
    );
  }

  const { items, estimatedTotal, supplier } = args as Args;
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
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Package className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            Purchase Order Review
          </p>
          {supplier && (
            <p className="text-xs text-muted-foreground">
              Supplier: {supplier}
            </p>
          )}
        </div>
      </div>

      {/* Items table */}
      <div className="mb-4 rounded-xl border border-border/50 bg-muted/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium text-right">Current</th>
              <th className="px-3 py-2 font-medium text-right">Order</th>
              <th className="px-3 py-2 font-medium text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.sku} className="border-b border-border/30">
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {item.sku}
                </td>
                <td className="px-3 py-2 text-foreground">{item.name}</td>
                <td
                  className={`px-3 py-2 text-right font-medium ${item.currentQty === 0 ? "text-red-600" : "text-amber-600"}`}
                >
                  {item.currentQty}
                </td>
                <td className="px-3 py-2 text-right text-foreground">
                  {item.reorderQty}
                </td>
                <td className="px-3 py-2 text-right font-medium text-foreground">
                  {formatCurrency(item.reorderQty * item.unitCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Estimated PO Total
          </span>
          <span className="text-sm font-bold text-foreground">
            {formatCurrency(estimatedTotal)}
          </span>
        </div>
      </div>

      {/* Status badge (complete state) */}
      {isComplete && (
        <div
          className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${wasApproved ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
        >
          {wasApproved ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <SkipForward className="h-3.5 w-3.5" />
          )}
          {wasApproved ? "PO Approved" : "Reorder Skipped"}
        </div>
      )}

      {/* Action buttons (executing state only) */}
      {status === ToolCallStatus.Executing && (
        <div className="flex gap-2">
          <Button
            onClick={() =>
              props.respond({
                approved: true,
                message: `PO approved for ${items.length} items, estimated ${formatCurrency(estimatedTotal)}`,
              })
            }
            className="flex-1"
          >
            Approve PO
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              props.respond({
                approved: false,
                message: "Reorder skipped by user",
              })
            }
            className="flex-1"
          >
            Skip Reorder
          </Button>
        </div>
      )}
    </div>
  );
}
