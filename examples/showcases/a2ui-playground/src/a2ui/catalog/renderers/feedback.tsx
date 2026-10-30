"use client";

import { AlertTriangle, CheckCircle2, Info, Inbox, Lightbulb, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RendererMap } from "./types";

const ALERT = {
  info: { icon: Info, cls: "border-sky-400/20 bg-sky-400/[0.06] text-sky-200", ic: "text-sky-300" },
  success: { icon: CheckCircle2, cls: "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100", ic: "text-emerald-300" },
  warning: { icon: AlertTriangle, cls: "border-amber-400/25 bg-amber-400/[0.07] text-amber-100", ic: "text-amber-300" },
  error: { icon: XCircle, cls: "border-rose-400/25 bg-rose-400/[0.07] text-rose-100", ic: "text-rose-300" },
} as const;

export const feedbackRenderers: RendererMap<"Alert" | "Callout" | "Skeleton" | "EmptyState"> = {
  Alert: ({ props }) => {
    const a = ALERT[props.tone ?? "info"];
    const Icon = a.icon;
    return (
      <div role="status" className={cn("a2-enter flex w-full min-w-0 gap-3 rounded-[12px] border px-3.5 py-3", a.cls)}>
        <Icon className={cn("mt-0.5 size-4 flex-none", a.ic)} />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-snug">{props.title}</p>
          {props.message ? <p className="mt-0.5 text-[12.5px] leading-relaxed opacity-80">{props.message}</p> : null}
        </div>
      </div>
    );
  },

  Callout: ({ props }) => (
    <div className="a2-enter @container relative flex w-full min-w-0 flex-wrap gap-3 overflow-hidden rounded-[var(--a2-radius)] border border-violet-400/20 bg-gradient-to-r from-violet-500/[0.10] via-violet-500/[0.04] to-transparent px-4 py-3.5">
      <div className="grid size-8 flex-none place-items-center rounded-lg bg-violet-400/15 text-[15px] text-violet-200">
        <Lightbulb className="size-4" />
      </div>
      <div className="min-w-[160px] flex-1">
        {props.title ? <p className="text-[13px] font-semibold">{props.title}</p> : null}
        <p className="text-[12.5px] leading-relaxed text-foreground/80">{props.text}</p>
      </div>
      {props.actionLabel ? (
        <Button size="sm" variant="secondary" className="self-center" onClick={() => props.action?.()}>
          {props.actionLabel}
        </Button>
      ) : null}
    </div>
  ),

  Skeleton: ({ props }) => {
    const v = props.variant ?? "text";
    if (v === "chart") {
      return (
        <div className="a2-card flex h-48 w-full items-end gap-2 p-4">
          {[40, 65, 50, 80, 58, 90, 72].map((h, i) => (
            <div key={i} className="a2-shimmer flex-1 rounded-md" style={{ height: `${h}%` }} />
          ))}
        </div>
      );
    }
    if (v === "card") {
      return (
        <div className="a2-card flex w-full gap-3 p-4">
          <div className="a2-shimmer size-10 flex-none rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <div className="a2-shimmer h-3 w-1/3 rounded" />
            <div className="a2-shimmer h-3 w-full rounded" />
            <div className="a2-shimmer h-3 w-4/5 rounded" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex w-full flex-col gap-2">
        {Array.from({ length: props.lines ?? 3 }).map((_, i, arr) => (
          <div key={i} className="a2-shimmer h-3 rounded" style={{ width: i === arr.length - 1 ? "60%" : "100%" }} />
        ))}
      </div>
    );
  },

  EmptyState: ({ props }) => (
    <div className="a2-enter flex w-full min-w-0 flex-col items-center gap-2 rounded-[var(--a2-radius)] border border-dashed border-white/12 px-6 py-8 text-center">
      <div className="mb-1 grid size-10 place-items-center rounded-full border border-[var(--a2-line)] bg-white/[0.04] text-muted-foreground">
        <Inbox className="size-4.5" />
      </div>
      <p className="text-[14px] font-semibold">{props.title}</p>
      {props.description ? <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">{props.description}</p> : null}
      {props.actionLabel ? (
        <Button size="sm" className="mt-2" onClick={() => props.action?.()}>
          {props.actionLabel}
        </Button>
      ) : null}
    </div>
  ),
};
