"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLES, formatCurrency } from "@/lib/crm";
import type { CrmState, Quote } from "@/lib/crm";

export default function QuotePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
        ? params.id[0]
        : undefined;

  const [crm, setCrm] = useState<CrmState | null>(null);
  const [failed, setFailed] = useState(false);

  // Self-contained fetch: the quote was persisted before we navigated here, so
  // the agent's snapshot already includes it (also works on reload / direct nav).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/crm")
      .then((r) => r.json())
      .then((s) => {
        if (!cancelled) setCrm(s as CrmState);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const quote: Quote | undefined = crm?.quotes?.find((q) => q.id === id);
  const account = quote
    ? crm?.accounts?.find((a) => a.id === quote.accountId)
    : undefined;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <button
          onClick={() => router.push("/")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </button>

        {failed && (
          <p className="text-sm text-muted-foreground">
            Couldn’t load this quote.
          </p>
        )}
        {!failed && !crm && (
          <div className="h-64 animate-pulse rounded-2xl bg-secondary" />
        )}
        {!failed && crm && !quote && (
          <p className="text-sm text-muted-foreground">Quote not found.</p>
        )}

        {quote && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-start justify-between gap-4 border-b border-border bg-secondary/40 p-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-primary">
                  <FileText className="h-5 w-5" />
                  <span className="text-sm font-semibold uppercase tracking-wide">
                    Hardware Quote
                  </span>
                </div>
                <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">
                  {quote.accountName}
                </h1>
                {account?.domain && (
                  <div className="text-sm text-muted-foreground">
                    {account.domain}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                <div className="font-mono text-sm text-foreground">
                  #{quote.id.toUpperCase()}
                </div>
                <div className="mt-1">
                  {new Date(quote.createdAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
                <span className="mt-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium capitalize text-emerald-700">
                  {quote.status}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-border px-6 py-3 text-sm">
              {quote.useCase && (
                <div>
                  <span className="text-muted-foreground">Use case: </span>
                  <span className="font-medium capitalize">
                    {quote.useCase}
                  </span>
                </div>
              )}
              {typeof quote.seats === "number" && (
                <div>
                  <span className="text-muted-foreground">Seats: </span>
                  <span className="font-medium tabular-nums">
                    {quote.seats}
                  </span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Prepared by: </span>
                <span className="font-medium">Northstar AI CRM</span>
              </div>
            </div>

            <div className="p-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-medium">Item</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">Unit</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {quote.lineItems.map((li) => (
                    <tr key={li.productId}>
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={li.photoUrl}
                            alt={li.name}
                            className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
                            onError={(e) => {
                              e.currentTarget.style.visibility = "hidden";
                            }}
                          />
                          <div className="min-w-0">
                            <div className="font-medium text-foreground">
                              {li.name}
                            </div>
                            <span
                              className={cn(
                                "mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
                                CATEGORY_STYLES[li.category],
                              )}
                            >
                              {li.category}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right tabular-nums">{li.qty}</td>
                      <td className="py-3 text-right tabular-nums">
                        {formatCurrency(li.unitPrice)}
                      </td>
                      <td className="py-3 text-right font-medium tabular-nums">
                        {formatCurrency(li.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 flex justify-end">
                <div className="w-full max-w-xs space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">
                      {formatCurrency(quote.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1.5 text-base font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">
                      {formatCurrency(quote.subtotal)}
                    </span>
                  </div>
                </div>
              </div>

              {quote.note && (
                <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
                  {quote.note}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
