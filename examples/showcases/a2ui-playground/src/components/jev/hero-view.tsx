"use client";

import { USE_CASES } from "@/jev/usecases";
import { cn } from "@/lib/utils";
import { BreakdownLine, breakdownOf, JevBar, LAYOUT_LABEL, PromptBar } from "./parts";
import { JevStage } from "./stage";
import { useJevRun } from "./use-jev-run";

/** Version 4: the number is the hero. Left: Jev's round trip, huge. Right: the surface it produced. */
export function HeroView() {
  const uc = USE_CASES.cafes;
  const { state, result, run, host } = useJevRun("cafes");
  const busy = state.phase === "running";
  const big = result ? result.jevMs : null;

  return (
    <div className="jev-root flex h-[100dvh] flex-col overflow-hidden">
      <JevBar />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(420px,0.8fr)_minmax(0,1.2fr)]">
        <section className="flex min-h-0 flex-col gap-8 border-r border-border px-12 pb-12 pt-10">
          <PromptBar defaultValue={uc.prompt} onSubmit={run} busy={busy} multiline />

          <div className="my-auto flex flex-col gap-5">
            <span className="flex items-center gap-2.5 font-mono text-[15px] text-muted-foreground">
              <span className={cn("jev-dot", busy && "jev-dot-pulse")} aria-hidden />
              {result ? "Jev decided in" : busy ? "Finding cafés, asking Jev" : "Jev round trip"}
            </span>
            <div className="flex items-baseline gap-3">
              <span className={cn("jev-hero-num text-[clamp(120px,13vw,240px)]", big == null ? cn("text-muted-foreground/25", busy && "jev-dot-pulse") : "text-foreground")}>{big == null ? "000" : Math.round(big)}</span>
              <span className="font-mono text-[clamp(28px,2.6vw,44px)] text-muted-foreground">ms</span>
            </div>
            <div className="min-h-7 text-[15px]">
              {breakdownOf(state) ? <BreakdownLine b={breakdownOf(state)!} source={result?.source} /> : null}
              {state.phase === "notice" ? <p className="mt-2 font-mono text-muted-foreground">{state.notice.notice}</p> : null}
              {state.phase === "error" ? <p className="mt-2 text-[oklch(0.75_0.15_25)]">{state.message}</p> : null}
            </div>
            <div className="min-h-[28px] text-[17px] leading-relaxed text-muted-foreground">
              {result ? (
                <p className="jev-row-in">
                  Picked <span className="text-foreground">{LAYOUT_LABEL[result.layout] ?? result.layout}</span> out of {Object.keys(result.layouts).length} layouts and ranked {result.ranked.length} real cafés in {result.places?.city ?? "the city"}, in one call.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="jev-canvas min-h-0 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[900px] flex-col justify-center px-12 py-12">
            <JevStage result={result} state={state} host={host} />
          </div>
        </section>
      </div>
    </div>
  );
}
