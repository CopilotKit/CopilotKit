"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CopilotKit, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { StaticSurface } from "@/components/app/static-surface";
import { CopilotKitKite } from "@/components/site/brand";
import { USE_CASES } from "@/jev/usecases";
import { useUIGeneration } from "@/components/app/use-ui-generation";
import {
  AskingJev,
  BreakdownLine,
  Dot,
  JevBar,
  LAYOUT_LABEL,
  PromptBar,
  useElapsed,
} from "./parts";
import { ms, useFixtureFlag } from "./use-jev-run";

type Decision = {
  jevMs: number;
  places?: { city: string; ms: number; count: number; cached?: boolean };
  source: string;
  layout: string;
  ranked: Array<{ name: string; fit: number }>;
  questionCount: number;
};
type Turn = {
  id: string;
  prompt: string;
  startedAt: number;
  decision?: Decision;
  ops?: Array<Record<string, unknown>>;
  renderedMs?: number;
  opsAt?: number;
  error?: string;
  notice?: string;
};

/** Version 2: chat first. CopilotKit runs the agent over AG-UI; the surface lands in the thread. */
export function ChatView() {
  return (
    <CopilotKit runtimeUrl="/api/jev-chat" enableInspector={false}>
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  const { agent } = useAgent({ agentId: "jev" });
  const { copilotkit } = useCopilotKit();
  const fixture = useFixtureFlag();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const patch = useCallback(
    (id: string, p: Partial<Turn>) =>
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t))),
    [],
  );

  const send = useCallback(
    async (text: string) => {
      if (!agent || busy || !text.trim()) return;
      const id = crypto.randomUUID();
      setBusy(true);
      setTurns((ts) => [
        ...ts,
        { id, prompt: text, startedAt: performance.now() },
      ]);
      const sub = agent.subscribe({
        onCustomEvent: ({ event }) => {
          if (event.name === "jev.decision")
            patch(id, { decision: event.value as Decision });
          if (event.name === "jev.notice")
            patch(id, {
              notice: String(
                (event.value as { message?: string })?.message ?? "",
              ),
            });
          if (event.name === "jev.error")
            patch(id, {
              error: String(
                (event.value as { message?: string })?.message ??
                  "Jev call failed",
              ),
            });
        },
        onActivitySnapshotEvent: ({ event }) => {
          const ops = (
            event.content as { operations?: Array<Record<string, unknown>> }
          )?.operations;
          if (Array.isArray(ops)) patch(id, { ops, opsAt: performance.now() });
        },
      });
      try {
        agent.addMessage({ id, role: "user", content: text });
        await copilotkit.runAgent({
          agent,
          forwardedProps: { fixture, usecase: "cafes" },
        });
      } catch (err) {
        patch(id, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        sub.unsubscribe();
        setBusy(false);
      }
    },
    [agent, busy, copilotkit, fixture, patch],
  );

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns.length]);

  return (
    <div className="jev-root flex h-[100dvh] flex-col overflow-hidden">
      <JevBar />
      <div ref={scroller} className="jev-canvas min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col gap-8 px-8 pb-10 pt-10">
          {turns.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <span className="grid size-12 place-items-center rounded-2xl border border-[var(--jev-line-strong)] bg-[var(--jev-panel)]">
                <CopilotKitKite className="size-6 text-foreground" />
              </span>
              <h1 className="text-[28px] font-semibold tracking-[-0.02em]">
                Where should you work today?
              </h1>
            </div>
          ) : (
            turns.map((t) => (
              <TurnView
                key={t.id}
                turn={t}
                onRendered={(renderedMs) => patch(t.id, { renderedMs })}
              />
            ))
          )}
        </div>
      </div>
      <div className="flex-none border-t border-border bg-[var(--background)]">
        <div className="mx-auto w-full max-w-[880px] px-8 py-5">
          <PromptBar
            defaultValue={USE_CASES.cafes.prompt}
            onSubmit={send}
            busy={busy}
          />
        </div>
      </div>
    </div>
  );
}

function TurnView({
  turn,
  onRendered,
}: {
  turn: Turn;
  onRendered: (ms: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const pending = !turn.ops && !turn.error && !turn.notice;
  const elapsed = useElapsed(
    pending || (turn.ops && turn.renderedMs == null) ? turn.startedAt : null,
  );

  // Rendered = the first frame after the surface's components are in the DOM.
  useEffect(() => {
    if (!turn.ops || turn.renderedMs != null) return;
    let raf = 0;
    const check = () => {
      if (host.current?.querySelector(".a2-node")) {
        raf = requestAnimationFrame(() =>
          onRendered(performance.now() - turn.startedAt),
        );
        return;
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [turn.ops, turn.renderedMs, turn.startedAt, onRendered]);

  useUIGeneration(host, {
    runKey: turn.ops ? turn.id : null,
    mode: "skeleton",
    duration: 900,
    maxParts: 40,
  });
  const d = turn.decision;
  return (
    <div className="flex flex-col gap-4">
      <div className="jev-row-in self-end rounded-2xl rounded-br-md bg-[var(--jev-raised)] px-4 py-2.5 text-[15.5px] text-foreground">
        {turn.prompt}
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex min-h-7 items-center gap-3">
          <span className="grid size-7 flex-none place-items-center rounded-lg border border-[var(--jev-line-strong)] bg-[var(--jev-panel)]">
            <CopilotKitKite className="size-3.5 text-foreground" />
          </span>
          {turn.error ? (
            <span className="text-[14px] text-[oklch(0.75_0.15_25)]">
              {turn.error}
            </span>
          ) : turn.notice ? (
            <span className="jev-row-in text-[14.5px] text-foreground">
              {turn.notice}
            </span>
          ) : d ? (
            <span className="jev-row-in min-w-0 truncate text-[14.5px] text-muted-foreground">
              Jev picked{" "}
              <span className="text-foreground">
                {LAYOUT_LABEL[d.layout] ?? d.layout}
              </span>
            </span>
          ) : (
            <AskingJev label="Finding cafés, asking Jev" />
          )}
          <span className="ml-auto flex flex-none items-center gap-2 whitespace-nowrap rounded-full border border-[var(--jev-line-strong)] bg-[var(--jev-panel)] px-3 py-1 text-[12.5px]">
            <Dot pulse={pending} />
            {d ? (
              <BreakdownLine
                b={{
                  placesMs: d.places?.ms,
                  placesCached: d.places?.cached,
                  jevMs: d.jevMs,
                  renderMs:
                    turn.renderedMs != null && turn.opsAt != null
                      ? turn.renderedMs - (turn.opsAt - turn.startedAt)
                      : undefined,
                  totalMs: turn.renderedMs,
                }}
                source={d.source}
              />
            ) : (
              <span className="font-mono tabular-nums">
                {turn.notice ? "no Jev call" : ms(elapsed)}
              </span>
            )}
          </span>
        </div>
        {turn.ops ? (
          <div ref={host} className="a2-surface-host relative">
            <StaticSurface ops={turn.ops as never} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
