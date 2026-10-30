"use client";

import "@/components/build-studio/build-page.css";
import "@/components/build-studio/build-motion.css";
import { useMemo, useState } from "react";
import { fillRecipe } from "@/components/build-studio/recipes";
import type { Recipe } from "@/components/build-studio/types";
import { USE_CASES } from "@/jev/usecases";
import { latestComponents } from "@/lib/run-store";
import {
  Decision,
  Json,
  Label,
  LiveStream,
  SlidingTabs,
  Stream,
} from "./inspector";
import {
  BreakdownGrid,
  breakdownOf,
  JevBar,
  PromptBar,
  SourceTag,
} from "./parts";
import { JevStage } from "./stage";
import { ms, useJevRun, type JevRunState } from "./use-jev-run";

type Tab = "build" | "json" | "stream";
const TABS: Array<[Tab, string]> = [
  ["build", "Build"],
  ["json", "JSON"],
  ["stream", "Stream"],
];

/** Copy that differs per use case. Everything else (layout, motion, inspector) is shared. */
const COPY: Record<
  "cafes" | "spending",
  { steps: string[]; done: (n: number) => string; wait: string }
> = {
  cafes: {
    steps: ["Cafés found", "Jev answered", "Building A2UI", "Revealing"],
    done: (n) => `${n} real cafés ranked`,
    wait: "Finding cafés, asking Jev",
  },
  spending: {
    steps: ["Jev answered", "View picked", "Writing A2UI", "Revealing"],
    done: (n) => `${n} categories scored`,
    wait: "Asking Jev",
  },
};

/** Versions 5 and 6: the /watch page, powered by Jev. Canvas with the generation run, composer, inspector. */
export function BuildView({
  recipes,
  usecase = "cafes",
}: {
  recipes: Recipe[];
  usecase?: "cafes" | "spending";
}) {
  const uc = USE_CASES[usecase];
  const copy = COPY[usecase];
  // v5 streams the run so the Stream tab fills in live; v6 keeps the single JSON response.
  const {
    state,
    result: raw,
    run,
    host,
    events,
  } = useJevRun(usecase, { stream: usecase === "cafes" });
  // v5 shows the café map on OpenFreeMap Liberty; the other versions keep CARTO Voyager.
  const result = useMemo(
    () =>
      raw && usecase === "cafes"
        ? {
            ...raw,
            ops: JSON.parse(
              JSON.stringify(raw.ops).replaceAll(
                '"basemap":"streets"',
                '"basemap":"liberty"',
              ),
            ),
          }
        : raw,
    [raw, usecase],
  );
  const [tab, setTab] = useState<Tab>("build");
  const busy = state.phase === "running";

  // MOTION.CSS beside the surface: the real recipes this surface's parts play.
  const code = useMemo(() => {
    if (!result) return null;
    const types = new Set<string>();
    for (const c of latestComponents(result.ops)) types.add(c.component);
    const keys = new Set([
      "skeleton reveal",
      "panel reveal",
      ...Array.from(types).map(fillRecipe),
    ]);
    return recipes
      .filter((r) => keys.has(r.key))
      .flatMap((r) => [...r.text.split("\n"), ""])
      .slice(0, 48);
  }, [result, recipes]);

  return (
    <div className="jev-root flex h-[100dvh] flex-col overflow-hidden">
      <JevBar jev={usecase === "cafes"} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_500px]">
        <section className="bs-root flex min-h-0 flex-col">
          <div className="bs-canvas relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {/* 1000px wide: still leaves the runtime's AGENT.LOG and MOTION.CSS about 200px of canvas on each side at 1920. */}
            <div className="relative mx-auto flex min-h-full w-full max-w-[1048px] flex-col justify-center px-6 py-12">
              {state.phase === "idle" ? (
                <p className="text-center font-mono text-[14px] text-muted-foreground/70">
                  Press Enter to ask Jev
                </p>
              ) : (
                <JevStage
                  result={result}
                  state={state}
                  host={host}
                  waitLabel={copy.wait}
                  gen={{
                    mode: "skeleton-texts",
                    duration: 1000,
                    steps: copy.steps,
                    done: result ? copy.done(result.ranked.length) : "Ready",
                    title: uc.prompt,
                    code,
                  }}
                />
              )}
            </div>
          </div>
          <div className="flex-none border-t border-border bg-[var(--background)] px-8 pt-5 pb-14">
            <div className="mx-auto flex w-full max-w-[820px] items-center gap-5">
              <PromptBar
                defaultValue={uc.prompt}
                onSubmit={run}
                busy={busy}
                className="flex-1"
              />
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l border-border bg-[var(--jev-panel)]">
          <nav className="flex h-16 flex-none items-center border-b border-border px-5">
            <SlidingTabs tabs={TABS} tab={tab} onChange={setTab} />
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {tab === "build" ? (
              <BuildTab state={state} usecase={usecase} />
            ) : tab === "json" ? (
              <Json result={result} />
            ) : usecase === "cafes" ? (
              <LiveStream events={events} state={state} />
            ) : (
              <Stream state={state} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function BuildTab({
  state,
  usecase,
}: {
  state: JevRunState;
  usecase: "cafes" | "spending";
}) {
  const result =
    state.phase === "painting" || state.phase === "done" ? state.result : null;
  const breakdown = breakdownOf(state);
  return (
    <div className="flex flex-col gap-7">
      <section>
        <Label
          left="Timings"
          right={state.phase === "running" ? "measuring" : undefined}
        />
        <div className="rounded-xl border border-[var(--jev-line)] bg-[var(--background)] px-5 py-4">
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span
              className={
                state.phase === "running" ? "jev-dot jev-dot-pulse" : "jev-dot"
              }
              aria-hidden
            />
            Jev decision
            {result && result.source !== "live" ? (
              <span className="ml-auto">
                <SourceTag source={result.source} />
              </span>
            ) : null}
          </p>
          <p className="mt-2 whitespace-nowrap font-mono text-[44px] font-medium leading-none tracking-[-0.04em] tabular-nums">
            {result ? (
              ms(result.jevMs)
            ) : (
              <span className="text-muted-foreground/25">000 ms</span>
            )}
          </p>
          <div className="mt-4 border-t border-[var(--jev-line)] pt-3">
            <BreakdownGrid
              b={{
                ...(breakdown ?? {}),
                placesMs:
                  usecase === "cafes"
                    ? ((breakdown?.placesMs ?? null) as number)
                    : undefined,
                jevMs: undefined,
              }}
            />
          </div>
        </div>
        {usecase === "cafes" ? (
          // v5: one short line, the call and what it cost.
          <p className="mt-4 whitespace-nowrap font-mono text-[15px] text-muted-foreground">
            {result ? (
              <>
                1 Jev call
                {result.usage?.inputTokens ? (
                  <>
                    {" "}
                    · {result.usage.inputTokens.toLocaleString("en-US")} tokens
                    ·{" "}
                    <span className="text-foreground">
                      ${jevCost(result.usage.inputTokens)}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              "1 Jev call per run"
            )}
          </p>
        ) : (
          <p className="mt-3 font-mono text-[12.5px] text-muted-foreground">
            {result
              ? `${result.model} · 1 call · ${result.questionCount} questions`
              : "jev-latest · 1 call per run"}
          </p>
        )}
        {state.phase === "error" ? (
          <p className="mt-3 text-[14px] text-[oklch(0.75_0.15_25)]">
            {state.message}
          </p>
        ) : null}
        {state.phase === "notice" ? (
          <p className="mt-3 text-[14px] text-muted-foreground">
            {state.notice.notice} No Jev call was made.
          </p>
        ) : null}
      </section>
      <Decision
        usecase={usecase}
        result={result}
        busy={state.phase === "running"}
      />
    </div>
  );
}

/** Jev's list price: $0.042 per million input tokens, output is free (Vercel AI Gateway pricing for typesafe-ai/jev). */
function jevCost(inputTokens: number) {
  return ((inputTokens * 0.042) / 1_000_000).toPrecision(2);
}
