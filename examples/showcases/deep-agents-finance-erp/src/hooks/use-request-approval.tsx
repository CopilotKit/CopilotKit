"use client";

import { useHumanInTheLoop, ToolCallStatus } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { InvoiceApprovalCard } from "@/components/chat/invoice-approval-card";
import { InventoryReorderCard } from "@/components/chat/inventory-reorder-card";

const invoiceSchema = z.object({
  number: z.string().describe("Invoice number, e.g. INV-2026-003"),
  client: z.string().describe("Client name"),
  amount: z.number().describe("Invoice amount in USD"),
  dueDate: z.string().describe("Due date in YYYY-MM-DD format"),
});

const reorderItemSchema = z.object({
  sku: z.string().describe("Item SKU"),
  name: z.string().describe("Item name"),
  currentQty: z.number().describe("Current quantity in stock"),
  reorderQty: z.number().describe("Proposed quantity to order"),
  unitCost: z.number().describe("Unit cost in USD"),
});

export function useRequestApproval() {
  useHumanInTheLoop({
    agentId: "finance_erp_agent",
    name: "request_approval",
    description:
      "Request human approval for a financial action. MANDATORY before processing any payment or reorder. Use type 'invoice_payment' for invoice payments, 'inventory_reorder' for purchase orders.",
    parameters: z.object({
      type: z
        .enum(["invoice_payment", "inventory_reorder"])
        .describe("Approval type"),
      invoices: z
        .array(invoiceSchema)
        .optional()
        .describe("(invoice_payment) Invoices to approve"),
      totalAmount: z
        .number()
        .optional()
        .describe("(invoice_payment) Sum of all invoice amounts"),
      action: z
        .string()
        .optional()
        .describe("(invoice_payment) Action description"),
      items: z
        .array(reorderItemSchema)
        .optional()
        .describe("(inventory_reorder) Items to reorder"),
      estimatedTotal: z
        .number()
        .optional()
        .describe("(inventory_reorder) Total estimated cost"),
      supplier: z
        .string()
        .optional()
        .describe("(inventory_reorder) Supplier name"),
    }),
    render: (props: any) => {
      const { args, status, respond, result } = props;

      if (args?.type === "inventory_reorder") {
        const cardArgs = {
          items: args.items ?? [],
          estimatedTotal: args.estimatedTotal ?? 0,
          supplier: args.supplier,
        };

        if (status === ToolCallStatus.InProgress) {
          return (
            <InventoryReorderCard
              status={status}
              args={cardArgs}
              respond={undefined}
              result={undefined}
            />
          );
        }
        if (status === ToolCallStatus.Complete) {
          return (
            <InventoryReorderCard
              status={status}
              args={cardArgs}
              respond={undefined}
              result={result}
            />
          );
        }
        return (
          <InventoryReorderCard
            status={status}
            args={cardArgs}
            respond={respond}
            result={undefined}
          />
        );
      }

      // Default: invoice_payment
      const cardArgs = {
        invoices: args?.invoices ?? [],
        totalAmount: args?.totalAmount ?? 0,
        action: args?.action ?? "Process payment",
      };

      if (status === ToolCallStatus.InProgress) {
        return (
          <InvoiceApprovalCard
            status={status}
            args={cardArgs}
            respond={undefined}
            result={undefined}
          />
        );
      }
      if (status === ToolCallStatus.Complete) {
        return (
          <InvoiceApprovalCard
            status={status}
            args={cardArgs}
            respond={undefined}
            result={result}
          />
        );
      }
      return (
        <InvoiceApprovalCard
          status={status}
          args={cardArgs}
          respond={respond}
          result={undefined}
        />
      );
    },
  });
}
