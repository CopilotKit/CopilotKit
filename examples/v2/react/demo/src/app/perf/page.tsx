"use client";

import React, { useCallback, useRef, useState } from "react";
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Sample content — varied lengths so the DOM work is realistic
// ---------------------------------------------------------------------------
const TEXTS = [
  "Sure! I'd be happy to help you with that.",
  "The weather in San Francisco today is 65°F with partly cloudy skies.",
  "Here are the main points from the meeting: 1) Roadmap review, 2) Bug triage, 3) Release planning.",
  "To configure a custom agent, extend AbstractAgent and implement the run() method.",
  "Here is a React component that fetches data from an API endpoint using useEffect and useState.",
  "The deployment succeeded. All health checks passed and the canary is at 100%.",
  "I found three matching files: config.ts, config.prod.ts, and config.test.ts.",
  "The pull request has been approved by two reviewers and is ready to merge.",
];

// ---------------------------------------------------------------------------
// HistoryAgent — emits N pre-built messages immediately on connect(), optionally
// with a delay between chunks to simulate live streaming.
// ---------------------------------------------------------------------------
class HistoryAgent extends AbstractAgent {
  protected messageCount = 0;
  protected streamDelayMs = 0;

  configure(count: number, streamDelayMs = 0) {
    this.messageCount = count;
    this.streamDelayMs = streamDelayMs;
  }

  clone(): this {
    const c = new (this.constructor as new () => HistoryAgent)() as this;
    c.agentId = this.agentId;
    (c as unknown as { messageCount: number }).messageCount = this.messageCount;
    (c as unknown as { streamDelayMs: number }).streamDelayMs =
      this.streamDelayMs;
    return c;
  }

  async detachActiveRun(): Promise<void> {}

  run(_input: RunAgentInput): Observable<BaseEvent> {
    // run() is called when the user submits a message — not needed for this demo.
    return new Observable<BaseEvent>((s) => s.complete());
  }

  // connect() is called by CopilotKitProvider on mount (thread history replay).
  // Emitting messages here is what makes them appear without user input.
  connect(_input: RunAgentInput): Observable<BaseEvent> {
    const delay = this.streamDelayMs;
    const n = this.messageCount;

    return new Observable<BaseEvent>((subscriber) => {
      // Record the wall-clock start time here — this is when connect() is
      // actually subscribed (after CopilotKitProvider's useEffect fires),
      // not when the button was clicked.
      if (typeof window !== "undefined") {
        (window as any).__perfConnectStart = performance.now();
      }

      const doEmit = async () => {
        subscriber.next({ type: EventType.RUN_STARTED } as BaseEvent);

        for (let i = 0; i < n; i++) {
          const msgId = `hist-${i}`;
          const text = TEXTS[i % TEXTS.length];
          for (let offset = 0; offset < text.length; offset += 20) {
            subscriber.next({
              type: EventType.TEXT_MESSAGE_CHUNK,
              messageId: msgId,
              delta: text.slice(offset, offset + 20),
            } as BaseEvent);
            if (delay > 0) await sleep(delay);
          }
        }

        subscriber.next({ type: EventType.RUN_FINISHED } as BaseEvent);
        // Signal completion via window so the poll in PerfPage (which holds a
        // reference to the original agent instance) can detect it. clone() runs
        // connect(), so setting this.isRunning on the clone wouldn't be visible
        // to the original.
        if (typeof window !== "undefined") {
          (window as any).__perfRunning = false;
        }
        subscriber.complete();
      };

      doEmit();
    });
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Render-count wrapper — counts how many times the message list re-renders
// ---------------------------------------------------------------------------
function RenderCounter({ onCount }: { onCount: (n: number) => void }) {
  const countRef = useRef(0);
  countRef.current += 1;
  // Report asynchronously to avoid setState-during-render
  React.useEffect(() => {
    onCount(countRef.current);
  });
  return null;
}

// ---------------------------------------------------------------------------
// Perf panel — displays live measurements
// ---------------------------------------------------------------------------
interface PerfResult {
  label: string;
  /** Time from connect() start to all events emitted (ms) */
  emitMs: number | null;
  /** Time from events emitted to render + animation settled (ms) */
  renderMs: number | null;
  renders: number | null;
}

function msColor(ms: number) {
  return ms < 500 ? "#7ee8a2" : ms < 2000 ? "#fbbf24" : "#f87171";
}

function PerfPanel({ results }: { results: PerfResult[] }) {
  if (results.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        background: "rgba(0,0,0,0.85)",
        color: "#e2e8f0",
        fontFamily: "monospace",
        fontSize: 13,
        padding: "12px 16px",
        borderRadius: 8,
        minWidth: 320,
        zIndex: 9999,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 8, color: "#7ee8a2" }}>
        ⚡ Perf Results
      </div>
      {results.map((r) => (
        <div key={r.label} style={{ marginBottom: 6 }}>
          <div style={{ color: "#94a3b8", marginBottom: 2 }}>{r.label}</div>
          <div style={{ paddingLeft: 8, fontSize: 12 }}>
            {r.emitMs !== null && (
              <span>
                <span style={{ color: "#64748b" }}>emit: </span>
                <span style={{ color: msColor(r.emitMs) }}>
                  {r.emitMs.toFixed(0)} ms
                </span>
              </span>
            )}
            {r.renderMs !== null && (
              <span style={{ marginLeft: 12 }}>
                <span style={{ color: "#64748b" }}>render+anim: </span>
                <span style={{ color: msColor(r.renderMs) }}>
                  {r.renderMs.toFixed(0)} ms
                </span>
              </span>
            )}
            {r.emitMs !== null && r.renderMs !== null && (
              <span style={{ marginLeft: 12 }}>
                <span style={{ color: "#64748b" }}>total: </span>
                <span style={{ color: msColor(r.emitMs + r.renderMs) }}>
                  {(r.emitMs + r.renderMs).toFixed(0)} ms
                </span>
              </span>
            )}
            {r.renders !== null && (
              <span style={{ color: "#c4b5fd", marginLeft: 12 }}>
                ({r.renders} renders)
              </span>
            )}
          </div>
        </div>
      ))}
      <div style={{ marginTop: 8, fontSize: 11, color: "#64748b" }}>
        Open React DevTools Profiler for flame charts
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const agent = new HistoryAgent();

export default function PerfPage() {
  const [key, setKey] = useState(0); // remount CopilotChat to reset state
  const [results, setResults] = useState<PerfResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [noAnim, setNoAnim] = useState(false); // disable StickToBottom spring when true
  const startTimeRef = useRef<number>(0);
  const renderCountRef = useRef(0);

  const pushResult = useCallback(
    (label: string, emitMs: number, renderMs: number, renders: number) => {
      const result = { label, emitMs, renderMs, renders };
      // Expose on window for programmatic access (Playwright, etc.)
      (window as any).__perfResults = (window as any).__perfResults ?? [];
      (window as any).__perfResults = [
        ...((window as any).__perfResults as PerfResult[]).filter(
          (r: PerfResult) => r.label !== label,
        ),
        result,
      ];
      console.log("[perf]", JSON.stringify(result));
      setResults((prev) => {
        const next = prev.filter((r) => r.label !== label);
        return [...next, result];
      });
    },
    [],
  );

  const run = useCallback(
    (count: number, streamDelayMs = 0) => {
      if (isRunning) return;
      setIsRunning(true);
      renderCountRef.current = 0;

      const suffix = noAnim ? " [noAnim]" : "";
      const label =
        streamDelayMs > 0
          ? `Stream ${count} msgs (${streamDelayMs}ms/chunk)${suffix}`
          : `Load ${count} msgs${suffix}`;

      agent.configure(count, streamDelayMs);
      startTimeRef.current = performance.now();
      (window as any).__perfRunning = true;
      (window as any).__perfMsgCount = 0;

      // Remount so CopilotChat starts fresh and calls connect() immediately.
      setKey((k) => k + 1);

      // Two-phase poll:
      //   Phase 1 ("emit")  — wait for the Observable to finish emitting events.
      //                        connect() sets __perfRunning=false when done.
      //   Phase 2 ("render") — wait for React to commit all messages (__perfMsgCount
      //                        reaches `count`) AND for the scroll position to
      //                        stabilise (3 consecutive identical scrollTop readings),
      //                        which means StickToBottom's spring animation has settled.
      // How many consecutive 50 ms polls with identical scrollTop = animation settled.
      const STABLE_POLLS_REQUIRED = 3;

      let phase: "emit" | "render" = "emit";
      let emitMs = 0;
      let stableCount = 0;
      // NaN ensures we don't start counting stability until we observe at least
      // one real scrollTop value (avoids false-positive when scrollEl is null).
      let lastScrollTop = NaN;

      const poll = setInterval(() => {
        if (phase === "emit") {
          if (!(window as any).__perfRunning) {
            const start =
              (window as any).__perfConnectStart ?? startTimeRef.current;
            emitMs = performance.now() - start;
            phase = "render";
          }
          return;
        }

        // Phase 2: wait for all messages committed + scroll stable.
        const msgCount = (window as any).__perfMsgCount ?? 0;
        if (msgCount < count) return; // still rendering

        const scrollEl = (window as any).__perfScrollEl as HTMLElement | null;
        const currentScrollTop = scrollEl?.scrollTop ?? 0;

        if (currentScrollTop === lastScrollTop) {
          stableCount++;
        } else {
          stableCount = 0;
          lastScrollTop = currentScrollTop;
        }

        if (stableCount >= STABLE_POLLS_REQUIRED) {
          clearInterval(poll);
          const start =
            (window as any).__perfConnectStart ?? startTimeRef.current;
          const totalMs = performance.now() - start;
          const renderMs = totalMs - emitMs;
          pushResult(label, emitMs, renderMs, renderCountRef.current);
          setIsRunning(false);
        }
      }, 50);
    },
    [isRunning, noAnim, pushResult],
  );

  const btnStyle: React.CSSProperties = {
    padding: "8px 16px",
    marginRight: 8,
    marginBottom: 8,
    borderRadius: 6,
    border: "none",
    background: isRunning ? "#334155" : "#3b82f6",
    color: "#fff",
    cursor: isRunning ? "not-allowed" : "pointer",
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: 600,
  };

  const toggleStyle: React.CSSProperties = {
    ...btnStyle,
    background: noAnim ? "#7c3aed" : "#1e293b",
    border: "1px solid #334155",
    cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Controls */}
      <div
        style={{
          padding: "12px 16px",
          background: "#0f172a",
          color: "#e2e8f0",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 4,
          borderBottom: "1px solid #1e293b",
        }}
      >
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            marginRight: 8,
            color: "#7ee8a2",
          }}
        >
          ⚡ CopilotChat perf
        </span>
        <button style={btnStyle} disabled={isRunning} onClick={() => run(50)}>
          Load 50
        </button>
        <button style={btnStyle} disabled={isRunning} onClick={() => run(100)}>
          Load 100
        </button>
        <button style={btnStyle} disabled={isRunning} onClick={() => run(500)}>
          Load 500
        </button>
        <button
          style={btnStyle}
          disabled={isRunning}
          onClick={() => run(100, 10)}
        >
          Stream 100 (10ms/chunk)
        </button>
        <button
          style={toggleStyle}
          disabled={isRunning}
          onClick={() => setNoAnim((v) => !v)}
          title="Toggle StickToBottom spring animation off (autoScroll=false)"
        >
          {noAnim ? "🚫 anim OFF" : "✨ anim ON"}
        </button>
        {isRunning && (
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              color: "#fbbf24",
              marginLeft: 8,
            }}
          >
            running…
          </span>
        )}
      </div>

      {/* Chat + render counter */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <CopilotKitProvider
          key={key}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          agents__unsafe_dev_only={{ default: agent as any }}
        >
          <RenderCounter
            onCount={(n) => {
              renderCountRef.current = n;
            }}
          />
          <div style={{ height: "100%" }}>
            <CopilotChat
              welcomeScreen={false}
              threadId={`perf-run-${key}`}
              autoScroll={!noAnim}
            />
          </div>
        </CopilotKitProvider>
      </div>

      <PerfPanel results={results} />
    </div>
  );
}
