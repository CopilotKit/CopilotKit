"use client";

import { useEffect, useState } from "react";
import type { Deal } from "../../data/types";
import { formatValue } from "../../data/format";
import { DataTable } from "../charts/data-table";
import { CardShell } from "./card-shell";

/**
 * Owns its own fetch rather than going through a shared hook — the card takes
 * only the tool's arguments as props, so it closes over nothing mutable.
 * Reopening a thread replays the recorded arguments and this effect refetches
 * current figures, which is what makes beat 2 (reload survives) hold by
 * construction.
 */
export function DealTableCard({
  status,
  region,
  minValue,
  title,
  note,
}: {
  status?: string;
  region?: string;
  minValue?: number;
  title?: string;
  note?: string;
}) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (region) params.set("region", region);
    if (minValue) params.set("minValue", String(minValue));
    Promise.resolve()
      .then(() => {
        if (!cancelled) setLoading(true);
        return fetch(`/api/vantage/v1/deals?${params.toString()}`);
      })
      .then((res) => (res.ok ? res.json() : { deals: [] }))
      .then((body) => {
        if (!cancelled) setDeals(body.deals ?? []);
      })
      .catch((err) => console.error("[vantage] deals failed", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, region, minValue]);

  return (
    <CardShell title={title ?? "Deals"} note={note} loading={loading}>
      <DataTable
        columns={["Account", "Value", "Stage", "Owner"]}
        rows={deals.map((d) => [
          d.account,
          formatValue(d.valueUsd, "usd", { compact: true }),
          d.stage,
          d.owner,
        ])}
      />
    </CardShell>
  );
}
