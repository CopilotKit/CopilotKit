"use client";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/charts";
import { formatCurrency } from "@/lib/crm";
import type { RepStats, Salesperson } from "@/lib/crm";
import { cn } from "@/lib/utils";

const ROLE_STYLES: Record<Salesperson["role"], string> = {
  AE: "bg-blue-100 text-blue-700",
  SDR: "bg-violet-100 text-violet-700",
  Manager: "bg-amber-100 text-amber-700",
};

/** Two-letter initials from a person's name (e.g. "Nathan Brooks" -> "NB"). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Circular avatar from a plain <img>; falls back to initials on load error. */
function RepAvatar({ name, src }: { name: string; src?: string }) {
  const [errored, setErrored] = useState(false);
  const showImg = src && !errored;
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-muted-foreground select-none">
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className="size-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span aria-label={name}>{initials(name)}</span>
      )}
    </span>
  );
}

/**
 * Per-rep performance card: avatar, name, role+region chip, an attainment gauge
 * (% + progress bar), bookings / open-pipeline / deal-count stats, and a
 * Sparkline of the rep's 8-month Closed-Won trend. Hover lift.
 */
export function RepCard({ stats }: { stats: RepStats }) {
  const { rep, bookings, openPipeline, attainment, dealCount, winRate, trend } =
    stats;
  const pct = Math.round(attainment * 100);
  const hasQuota = rep.quota > 0;

  return (
    <Card className="gap-4 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <div className="flex items-center gap-3">
        <RepAvatar name={rep.name} src={rep.avatarUrl} />
        <div className="min-w-0">
          <div className="truncate font-medium leading-tight">{rep.name}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge className={cn("px-2 py-0", ROLE_STYLES[rep.role])}>
              {rep.role}
            </Badge>
            <span className="truncate text-xs text-muted-foreground">
              {rep.region}
            </span>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Quota attainment</span>
          <span className="font-medium tabular-nums">
            {hasQuota ? `${pct}%` : "—"}
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-chart-1 transition-[width] duration-500"
            style={{ width: hasQuota ? `${Math.min(100, pct)}%` : "0%" }}
          />
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-[11px] text-muted-foreground">Bookings</dt>
          <dd className="font-semibold tabular-nums">
            {formatCurrency(bookings)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Open pipe</dt>
          <dd className="font-semibold tabular-nums">
            {formatCurrency(openPipeline)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Deals</dt>
          <dd className="font-semibold tabular-nums">
            {dealCount}
            {winRate !== null ? (
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                · {Math.round(winRate * 100)}% win
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">
          Bookings · last 8 mo
        </div>
        <Sparkline data={trend} />
      </div>
    </Card>
  );
}
