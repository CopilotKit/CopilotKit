"use client";

import { useRenderTool, useCopilotKit, useAgent } from "@copilotkit/react-core/v2";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

const knownClients = [
  "Acme Corp",
  "Globex Industries",
  "Initech LLC",
  "Massive Dynamic",
  "Umbrella Corp",
  "Wayne Enterprises",
  "Stark Industries",
  "Soylent Industries",
  "Cyberdyne Systems",
];

function InvoiceFormComponent({
  prefillClient,
  prefillItems,
}: {
  prefillClient?: string;
  prefillItems?: LineItem[];
}) {
  const { agent } = useAgent({ agentId: "finance_erp_agent" });
  const { copilotkit } = useCopilotKit();

  const [client, setClient] = useState(prefillClient || "");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<LineItem[]>(
    prefillItems?.length
      ? prefillItems
      : [{ description: "", quantity: 1, unitPrice: 0 }],
  );
  const [submitted, setSubmitted] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredClients = knownClients.filter((c) =>
    c.toLowerCase().includes(client.toLowerCase()),
  );

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const tax = subtotal * 0.08;
  const total = subtotal + tax;

  const addItem = () => {
    setItems([...items, { description: "", quantity: 1, unitPrice: 0 }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = [...items];
    if (field === "description") {
      updated[index] = { ...updated[index], description: value as string };
    } else {
      updated[index] = { ...updated[index], [field]: Number(value) || 0 };
    }
    setItems(updated);
  };

  const handleSubmit = async () => {
    if (!client || items.some((i) => !i.description || i.unitPrice <= 0)) return;
    setSubmitted(true);

    try {
      if (agent.isRunning) {
        copilotkit.stopAgent({ agent });
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: `I've completed the invoice form. Please create the invoice with these details:
- Client: ${client}
- Due Date: ${dueDate || "Net 30"}
- Line Items: ${items.map((i) => `${i.description} (${i.quantity} × ${formatCurrency(i.unitPrice)})`).join(", ")}
- Subtotal: ${formatCurrency(subtotal)}
- Tax (8%): ${formatCurrency(tax)}
- Total: ${formatCurrency(total)}

Please confirm and process this invoice.`,
      });
      void copilotkit.runAgent({ agent });
    } catch (err) {
      console.error("InvoiceForm: failed to submit:", err);
    }
  };

  if (submitted) {
    return (
      <Card className="w-full border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="pt-4 text-center">
          <span className="text-3xl">✅</span>
          <p className="text-sm font-medium mt-2">Invoice submitted for review</p>
          <p className="text-xs text-muted-foreground mt-1">
            {client} — {formatCurrency(total)}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          ✏️ New Invoice
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Client */}
        <div className="relative">
          <label className="text-xs text-muted-foreground block mb-1">Client</label>
          <input
            type="text"
            value={client}
            onChange={(e) => {
              setClient(e.target.value);
              setShowSuggestions(true);
            }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Client name..."
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {showSuggestions && client && filteredClients.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-32 overflow-y-auto">
              {filteredClients.map((c) => (
                <button
                  key={c}
                  type="button"
                  onMouseDown={() => {
                    setClient(c);
                    setShowSuggestions(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Due Date */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Line Items */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Line Items</label>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => updateItem(i, "description", e.target.value)}
                  placeholder="Description"
                  className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <input
                  type="number"
                  value={item.quantity || ""}
                  onChange={(e) => updateItem(i, "quantity", e.target.value)}
                  placeholder="Qty"
                  min={1}
                  className="w-14 px-2 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
                />
                <input
                  type="number"
                  value={item.unitPrice || ""}
                  onChange={(e) => updateItem(i, "unitPrice", e.target.value)}
                  placeholder="Price"
                  min={0}
                  className="w-20 px-2 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-right"
                />
                <span className="text-xs font-medium text-muted-foreground w-16 text-right self-center">
                  {formatCurrency(item.quantity * item.unitPrice)}
                </span>
                {items.length > 1 && (
                  <button
                    onClick={() => removeItem(i)}
                    className="text-xs text-red-400 hover:text-red-500 self-center"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addItem}
            className="mt-2 text-xs text-primary hover:underline"
          >
            + Add line item
          </button>
        </div>

        {/* Totals */}
        <div className="border-t pt-2 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Tax (8%)</span>
            <span>{formatCurrency(tax)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!client || items.some((i) => !i.description || i.unitPrice <= 0)}
          className="w-full py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Submit for Review
        </button>
      </CardContent>
    </Card>
  );
}

export function useRenderInvoiceForm() {
  useRenderTool(
    {
      name: "render_invoice_form",
      render: ({ args }: any) => {
        if (!args) {
          return (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 animate-pulse text-sm text-muted-foreground">
              Preparing invoice form...
            </div>
          );
        }

        return (
          <InvoiceFormComponent
            prefillClient={args.client}
            prefillItems={args.items}
          />
        );
      },
    } as any,
    [],
  );
}
