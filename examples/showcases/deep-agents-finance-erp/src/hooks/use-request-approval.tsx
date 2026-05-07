"use client";

import {
  ToolCallStatus,
  useInterrupt,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { InvoiceApprovalCard } from "@/components/chat/invoice-approval-card";
import { InventoryReorderCard } from "@/components/chat/inventory-reorder-card";

type ApprovalArgs = {
  type: "invoice_payment" | "inventory_reorder";
  invoices?: Array<{
    number: string;
    client: string;
    amount: number;
    dueDate: string;
  }>;
  totalAmount?: number;
  action?: string;
  items?: Array<{
    sku: string;
    name: string;
    currentQty: number;
    reorderQty: number;
    unitCost: number;
  }>;
  estimatedTotal?: number;
  supplier?: string;
};

type InterruptValue = {
  __copilotkit_interrupt_value__?: {
    action?: string;
    args?: ApprovalArgs;
  };
};

// `event.value` arrives as a JSON-encoded string from the runtime, not an
// object. Decode here so the rest of the hook can work with structured data.
function parseInterruptValue(raw: unknown): InterruptValue | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as InterruptValue;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") return raw as InterruptValue;
  return undefined;
}

export function useRequestApproval() {
  // Suppress the wildcard `useRenderTool({ name: "*" })` from rendering a generic
  // ToolCard for `request_approval`. The actual approval UI is handled by
  // useInterrupt below — the agent's `copilotkit_interrupt(action="request_approval", ...)`
  // pauses the LangGraph run and emits an `on_interrupt` custom event, not a
  // normal tool execution.
  useRenderTool(
    {
      name: "request_approval",
      render: () => null,
    },
    [],
  );

  useInterrupt({
    agentId: "finance_erp_agent",
    enabled: (event) => {
      const value = parseInterruptValue(event.value);
      return (
        value?.__copilotkit_interrupt_value__?.action === "request_approval"
      );
    },
    render: ({ event, resolve }) => {
      const value = parseInterruptValue(event.value);
      const args = value?.__copilotkit_interrupt_value__?.args;
      if (!args) return null;

      const respond = async (result: unknown) => {
        resolve(result);
      };

      if (args.type === "inventory_reorder") {
        const formatCurrency = (n: number) =>
          new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(n);
        const items = args.items ?? [];
        const estimatedTotal = args.estimatedTotal ?? 0;
        return (
          <InventoryReorderCard
            status={ToolCallStatus.Executing}
            args={{
              items,
              estimatedTotal,
              supplier: args.supplier,
            }}
            respond={async (result) => {
              if (result === undefined || result === null) {
                await respond({
                  approved: false,
                  message: "Reorder skipped by user",
                });
              } else {
                await respond(result);
              }
            }}
            result={undefined}
          />
        );
        void formatCurrency;
      }

      // Default: invoice_payment
      const invoices = args.invoices ?? [];
      const totalAmount = args.totalAmount ?? 0;
      const action = args.action ?? "Process payment";
      return (
        <InvoiceApprovalCard
          status={ToolCallStatus.Executing}
          args={{ invoices, totalAmount, action }}
          respond={respond}
          result={undefined}
        />
      );
    },
  });
}
