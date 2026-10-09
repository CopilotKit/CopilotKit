"use client";

import { cn } from "@/lib/utils";
import { formatDate } from "../data/format";
import type { Receipt } from "../data/recon-seed";

/**
 * A receipt as it was photographed or forwarded: thermal slips for cafes and
 * restaurants (a tip written in pen on the restaurant's), a printed order
 * summary, a hotel folio in euros, an airline e-ticket, a coworking invoice.
 * Pure markup at a fixed 240px width; `ReceiptThumb` scales it down, so the
 * thumbnail is the same document, not a summary of it.
 */

const W = 240;

function money(n: number, currency: Receipt["currency"]) {
  if (currency === "EUR")
    return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Row({
  label,
  value,
  bold,
  dots = true,
}: {
  label: string;
  value: string;
  bold?: boolean;
  dots?: boolean;
}) {
  return (
    <div className={cn("flex items-baseline gap-1", bold && "font-bold")}>
      <span className="shrink-0">{label}</span>
      {dots ? (
        <span className="mb-[3px] min-w-2 flex-1 border-b border-dotted border-current opacity-30" />
      ) : (
        <span className="flex-1" />
      )}
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

function Handwriting({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("text-[15px] leading-tight text-[#1f3fa8]", className)}
      style={{
        fontFamily: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
        transform: "rotate(-3deg)",
      }}
    >
      {children}
    </div>
  );
}

function Thermal({ r }: { r: Receipt }) {
  const sub = r.lines.reduce((n, l) => n + l.amount, 0);
  return (
    <div className="font-mono text-[10px] leading-[1.45] text-[#2b2b2b]">
      <div className="text-center">
        <div className="text-[13px] font-bold uppercase tracking-[0.18em]">
          {r.merchant}
        </div>
        {r.address ? (
          <div className="mt-0.5 opacity-70">{r.address}</div>
        ) : null}
        <div className="mt-1 opacity-70">
          {formatDate(r.date)} 2026{r.time ? ` · ${r.time}` : ""}
        </div>
        {r.reference ? <div className="opacity-70">{r.reference}</div> : null}
      </div>
      <div className="my-2 border-t border-dashed border-current opacity-40" />
      {r.lines.map((l) => (
        <Row
          key={l.label}
          label={l.label}
          value={money(l.amount, r.currency)}
        />
      ))}
      <div className="my-2 border-t border-dashed border-current opacity-40" />
      <Row label="Subtotal" value={money(sub, r.currency)} dots={false} />
      {r.tax ? (
        <Row label="Tax" value={money(r.tax, r.currency)} dots={false} />
      ) : null}
      <Row label="TOTAL" value={money(r.total, r.currency)} bold dots={false} />
      {r.handwrittenTip ? (
        <div className="mt-2 space-y-1">
          <div className="flex items-baseline justify-between">
            <span>TIP</span>
            <Handwriting>{r.handwrittenTip.toFixed(2)}</Handwriting>
          </div>
          <div className="flex items-baseline justify-between">
            <span>TOTAL</span>
            <Handwriting>{(r.total + r.handwrittenTip).toFixed(2)}</Handwriting>
          </div>
        </div>
      ) : null}
      <div className="mt-2 text-center opacity-70">{r.payment} · APPROVED</div>
      <div className="mt-1 text-center opacity-50">THANK YOU</div>
    </div>
  );
}

function Printed({ r }: { r: Receipt }) {
  const title =
    r.kind === "order"
      ? "Order summary"
      : r.kind === "hotel"
        ? "Facture / Folio"
        : r.kind === "airline"
          ? "E-ticket receipt"
          : "Invoice";
  const accent =
    r.kind === "order"
      ? "#131921"
      : r.kind === "hotel"
        ? "#6b4f2a"
        : r.kind === "airline"
          ? "#1b3a8a"
          : "#111";
  return (
    <div className="font-sans text-[10px] leading-[1.45] text-[#222]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div
            className="text-[13px] font-bold tracking-[-0.01em]"
            style={{ color: accent }}
          >
            {r.merchant}
          </div>
          {r.address ? (
            <div className="text-[9px] opacity-60">{r.address}</div>
          ) : null}
        </div>
        <div
          className="rounded-sm px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white"
          style={{ background: accent }}
        >
          {title}
        </div>
      </div>
      <div className="mt-1.5 text-[9px] opacity-70">
        {r.reference ? <div>{r.reference}</div> : null}
        <div>
          {r.kind === "hotel" ? "Date" : "Placed"} {formatDate(r.date)} 2026
        </div>
      </div>
      <div className="mt-2 space-y-0.5 border-t border-[#ddd] pt-1.5">
        {r.lines.map((l) => (
          <Row
            key={l.label}
            label={l.label}
            value={money(l.amount, r.currency)}
            dots={false}
          />
        ))}
      </div>
      <div className="mt-1.5 border-t border-[#ddd] pt-1.5">
        <Row
          label={
            r.currency === "EUR"
              ? "Total TTC"
              : r.kind === "order"
                ? "Grand total"
                : "Total"
          }
          value={money(r.total, r.currency)}
          bold
          dots={false}
        />
      </div>
      <div className="mt-1.5 text-[9px] opacity-60">
        Paid with {r.payment}
        {r.currency === "EUR" ? " · billed in EUR" : ""}
      </div>
    </div>
  );
}

export function ReceiptPaper({
  receipt,
  className,
}: {
  receipt: Receipt;
  className?: string;
}) {
  const thermal = receipt.kind === "cafe" || receipt.kind === "restaurant";
  return (
    <div
      className={cn("relative bg-white px-4 pb-6 pt-4", className)}
      style={{
        width: W,
        // Thermal slips get a torn edge; printed documents a clean page.
        clipPath: thermal
          ? "polygon(0 0,100% 0,100% calc(100% - 6px),95% 100%,90% calc(100% - 6px),85% 100%,80% calc(100% - 6px),75% 100%,70% calc(100% - 6px),65% 100%,60% calc(100% - 6px),55% 100%,50% calc(100% - 6px),45% 100%,40% calc(100% - 6px),35% 100%,30% calc(100% - 6px),25% 100%,20% calc(100% - 6px),15% 100%,10% calc(100% - 6px),5% 100%,0 calc(100% - 6px))"
          : undefined,
        backgroundImage: thermal
          ? "linear-gradient(180deg, rgba(0,0,0,0.015), rgba(0,0,0,0) 30%, rgba(0,0,0,0.02))"
          : undefined,
      }}
    >
      {thermal ? <Thermal r={receipt} /> : <Printed r={receipt} />}
    </div>
  );
}

/** The receipt, scaled into a fixed thumbnail frame. */
export function ReceiptThumb({
  receipt,
  width = 132,
  height = 168,
  fill = false,
  className,
}: {
  receipt: Receipt;
  /** The paper's width in the thumbnail. */
  width?: number;
  height?: number;
  /** Stretch the frame to its container, with the paper centered in it. */
  fill?: boolean;
  className?: string;
}) {
  const scale = width / W;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[6px] bg-[hsl(225_14%_95%)]",
        fill && "w-full",
        className,
      )}
      style={{ width: fill ? undefined : width, height }}
    >
      <div
        className={cn(
          "absolute top-0 origin-top-left",
          fill ? "left-1/2" : "left-0",
        )}
        style={{
          transform: `${fill ? `translateX(-${width / 2}px) translateY(8px) ` : ""}scale(${scale})`,
          filter: "drop-shadow(0 1px 1px rgba(20,24,40,0.10))",
        }}
      >
        <ReceiptPaper receipt={receipt} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[hsl(225_14%_95%)] to-transparent" />
    </div>
  );
}
