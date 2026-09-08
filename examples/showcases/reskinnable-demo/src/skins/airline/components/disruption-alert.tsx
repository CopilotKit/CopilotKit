"use client";

import { AlertCircle, AlertTriangle, CloudRain, DoorOpen } from "lucide-react";
import type { DisruptionAlert as DisruptionAlertModel } from "../data/types";
import { cn, lookup } from "./utils";

interface DisruptionAlertProps {
  disruption: DisruptionAlertModel;
}

const SEVERITY_STYLES: Record<
  DisruptionAlertModel["severity"],
  { bg: string; icon: string; ring: string; label: string }
> = {
  info: {
    bg: "bg-brand-soft",
    icon: "text-brand",
    ring: "ring-brand/30",
    label: "text-brand",
  },
  warning: {
    bg: "bg-amber-50",
    icon: "text-amber-600",
    ring: "ring-amber-500/30",
    label: "text-amber-700",
  },
  critical: {
    bg: "bg-negative-soft",
    icon: "text-negative",
    ring: "ring-negative/30",
    label: "text-negative",
  },
};

const TYPE_LABEL: Record<DisruptionAlertModel["type"], string> = {
  delay: "Delay",
  cancellation: "Cancellation",
  gate_change: "Gate Change",
  weather: "Weather",
};

function TypeIcon({
  type,
  className,
}: {
  type: DisruptionAlertModel["type"];
  className?: string;
}) {
  switch (type) {
    case "weather":
      return <CloudRain className={className} />;
    case "gate_change":
      return <DoorOpen className={className} />;
    case "cancellation":
      return <AlertCircle className={className} />;
    default:
      return <AlertTriangle className={className} />;
  }
}

export function DisruptionAlert({ disruption }: DisruptionAlertProps) {
  const s = lookup(SEVERITY_STYLES, disruption.severity, SEVERITY_STYLES.info);
  const typeLabel = lookup(TYPE_LABEL, disruption.type, "Update");
  return (
    <div className={cn("rounded-2xl p-5 shadow-soft ring-1", s.bg, s.ring)}>
      <div className="flex items-start gap-3">
        <TypeIcon
          type={disruption.type}
          className={cn("mt-0.5 h-5 w-5 shrink-0", s.icon)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "text-xs font-semibold uppercase tracking-wider",
                s.label,
              )}
            >
              {typeLabel}
            </span>
            <span className="font-mono text-xs text-ink-muted">
              {disruption.flight_number}
            </span>
          </div>
          <p className="mt-1 text-sm leading-snug text-ink">
            {disruption.message}
          </p>
          {(disruption.new_departure_time || disruption.new_gate) && (
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              {disruption.new_departure_time ? (
                <span className="rounded-md bg-surface/60 px-2 py-1 font-mono text-ink">
                  New departure:{" "}
                  <strong>{disruption.new_departure_time}</strong>
                </span>
              ) : null}
              {disruption.new_gate ? (
                <span className="rounded-md bg-surface/60 px-2 py-1 font-mono text-ink">
                  New gate: <strong>{disruption.new_gate}</strong>
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
