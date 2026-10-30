"use client";

import { useState } from "react";
import { USE_CASES, type UseCaseId } from "@/jev/usecases";
import { Decision, Json, SlidingTabs, Stream } from "./inspector";
import { JevBar, PromptBar, Timing } from "./parts";
import { JevStage } from "./stage";
import { useJevRun } from "./use-jev-run";

type Tab = "decision" | "stream" | "json";
const TABS: Array<[Tab, string]> = [
  ["decision", "Decision"],
  ["stream", "Stream"],
  ["json", "JSON"],
];

/** Version 1: the surface on the left, Jev's decision on the right. */
export function SplitView({ usecase = "cafes" }: { usecase?: UseCaseId }) {
  const uc = USE_CASES[usecase];
  const { state, result, run, host } = useJevRun(usecase);
  const [tab, setTab] = useState<Tab>("decision");
  const busy = state.phase === "running";

  return (
    <div className="jev-root flex h-[100dvh] flex-col overflow-hidden">
      <JevBar />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_460px]">
        <section className="jev-canvas min-h-0 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[960px] flex-col justify-center gap-5 px-10 py-10">
            <PromptBar defaultValue={uc.prompt} onSubmit={run} busy={busy} />
            <Timing state={state} className="h-6 px-1 text-[15px]" />
            <div className="mt-1 min-h-[520px]">
              <JevStage result={result} state={state} host={host} />
            </div>
          </div>
        </section>
        <aside className="flex min-h-0 flex-col border-l border-border bg-[var(--jev-panel)]">
          <nav className="flex h-16 flex-none items-center border-b border-border px-5">
            <SlidingTabs tabs={TABS} tab={tab} onChange={setTab} />
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {tab === "decision" ? <Decision usecase={usecase} result={result} busy={busy} /> : tab === "stream" ? <Stream state={state} /> : <Json result={result} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
