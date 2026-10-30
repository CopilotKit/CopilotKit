"use client";

import { Check } from "lucide-react";
import { USE_CASES } from "@/jev/usecases";
import { cn } from "@/lib/utils";
import { JevBar, LAYOUT_LABEL, PromptBar, Timing } from "./parts";
import { JevStage } from "./stage";
import { useJevRun } from "./use-jev-run";

/** Version 3: a different request (laptops). One column: the ask, Jev's layout pick as a strip, the surface. */
export function CompareView() {
  const uc = USE_CASES.laptops;
  const { state, result, run, host } = useJevRun("laptops");
  const busy = state.phase === "running";
  const layouts = Object.keys(uc.layouts);

  return (
    <div className="jev-root flex h-[100dvh] flex-col overflow-hidden">
      <JevBar />
      <div className="jev-canvas min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1080px] flex-col justify-center gap-5 px-10 py-12">
          <PromptBar
            defaultValue={uc.prompt}
            onSubmit={run}
            busy={busy}
            size="lg"
          />

          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="mr-1 font-mono text-[13px] text-muted-foreground">
              layout
            </span>
            {layouts.map((l, i) => {
              const picked = result?.layout === l;
              const p = result?.layoutProbabilities[l];
              return (
                <span
                  key={`${l}-${result?.surfaceId ?? "idle"}`}
                  className={cn(
                    "jev-row-in flex items-center gap-2 rounded-full border px-3 py-1 text-[13.5px]",
                    picked
                      ? "border-[oklch(0.72_0.17_292/50%)] bg-[var(--jev-accent-soft)] text-foreground"
                      : "border-[var(--jev-line)] text-muted-foreground",
                  )}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  {picked ? (
                    <Check
                      className="size-3.5 text-[var(--jev-accent)]"
                      strokeWidth={3}
                    />
                  ) : null}
                  {LAYOUT_LABEL[l] ?? l}
                  {p != null ? (
                    <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                      {Math.round(p * 100)}%
                    </span>
                  ) : null}
                </span>
              );
            })}
            <Timing state={state} className="ml-auto text-[14px]" />
          </div>

          <div className="mt-2 min-h-[436px]">
            <JevStage
              result={result}
              state={state}
              host={host}
              waitLabel="Asking Jev"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
