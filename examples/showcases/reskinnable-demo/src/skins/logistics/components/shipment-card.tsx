"use client";

import type { Lane, Shipment } from "../data/types";
import { HandlingDetail } from "./handling-strip";
import { cn } from "@/lib/utils";

const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function daysBetween(fromIso: string, toIso: string): number {
  const ms =
    Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

const STATUS_LABEL: Record<Shipment["status"], string> = {
  on_track: "On track",
  at_risk: "At risk",
  delayed: "Delayed",
  resolved: "Resolved",
};

const STATUS_TONE: Record<Shipment["status"], string> = {
  on_track: "bg-positive-soft text-positive",
  at_risk: "bg-negative-soft text-negative",
  delayed: "bg-negative-soft text-negative",
  resolved: "bg-surface-muted text-ink-muted",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="mt-0.5 tabular-nums text-ink">{value}</div>
    </div>
  );
}

export function ShipmentCard({
  shipment,
  lane,
}: {
  shipment: Shipment;
  lane?: Lane;
}) {
  const delta = daysBetween(shipment.slaDate, shipment.etaCurrent);
  const late = delta > 0;

  return (
    <div className="rounded-lg border border-hairline bg-surface p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-ink">
            {shipment.reference}
          </div>
          <div className="text-sm text-ink-muted">
            {lane ? `${lane.origin} → ${lane.destination}` : shipment.laneId} ·{" "}
            {shipment.carrier}
          </div>
        </div>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium",
            STATUS_TONE[shipment.status],
          )}
        >
          {STATUS_LABEL[shipment.status]}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Field label="Units" value={shipment.units.toLocaleString("en-US")} />
        <Field
          label="Weight"
          value={`${shipment.weightKg.toLocaleString("en-US")} kg`}
        />
        <Field label="Value" value={fmtUsd(shipment.valueUsd)} />
      </div>

      <div className="mt-4 flex items-baseline justify-between border-t border-hairline pt-3 text-sm">
        <span className="text-ink-muted">
          ETA {shipment.etaCurrent} · SLA {shipment.slaDate}
        </span>
        <span
          className={cn(
            "font-medium tabular-nums",
            late ? "text-negative" : "text-positive",
          )}
        >
          {delta === 0
            ? "On SLA"
            : late
              ? `${delta}d late`
              : `${-delta}d early`}
        </span>
      </div>

      {shipment.exception ? (
        <div className="mt-3 rounded-md bg-surface-muted p-3 text-sm">
          <span className="font-medium text-ink">
            {shipment.exception.code}
          </span>
          <span className="text-ink-muted"> — {shipment.exception.detail}</span>
        </div>
      ) : null}

      {/* BEAT 5 — the watch flag, the carrier notice and the 🚨 note the stored
          procedure left behind. Above the applied mitigation because it is the
          most recent thing to have happened to this shipment. */}
      <HandlingDetail shipment={shipment} />

      {shipment.appliedMitigation ? (
        <div className="mt-3 text-sm text-ink-muted">
          Applied mitigation:{" "}
          <span className="font-medium capitalize text-ink">
            {shipment.appliedMitigation.kind}
          </span>{" "}
          ({fmtUsd(shipment.appliedMitigation.costUsd)})
        </div>
      ) : null}
    </div>
  );
}
