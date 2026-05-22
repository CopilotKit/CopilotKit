/**
 * CopilotKit Studio — Timeline demo (M5).
 *
 * Standalone visual harness for the Timeline drawer. Lives next to
 * `timeline.tsx` so visual review and component refactors stay in lockstep.
 *
 * Not wired into `App.tsx` (that's the M7 integration's job). To eyeball:
 *   - Import `TimelineDemo` into a scratch entry point, e.g.
 *     `src/spa/main.tsx` swaps `<App />` for `<TimelineDemo />` temporarily.
 *   - Or render directly from the (future) demo route.
 *
 * The demo exercises:
 *   1. Empty state when `connected={false}`.
 *   2. Empty state when `connected={true}` but no events.
 *   3. Live event flow via a mock EventSource — clicking "Emit synthetic
 *      invocation" pushes a `frontend_tool.invoked` envelope through the
 *      same `reduceTimeline` reducer the real client uses.
 *   4. Reproduce-callback wiring (logs to the demo panel).
 *   5. Filter mode switching.
 *   6. Cmd+J expand/collapse.
 *   7. New-event flash when collapsed.
 *
 * Mock event source: a tiny shim that simulates the runtime emitting events.
 * Same shape the real `DebugStream` consumes, so any change here ripples
 * through `sse-client.ts` naturally.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

import type { DebugEventEnvelope, TimelineEvent } from "../../shared/types.js";
import { reduceTimeline } from "../lib/sse-client.js";
import { Timeline } from "./timeline.js";
import type { TimelineFilter } from "./timeline.js";

const DEMO_TOOLS = [
  "render_stock_chart",
  "user_form",
  "weather_card",
  "pricing_table",
  "render_a2ui",
] as const;

/**
 * Hand-written seed events so the drawer has content the moment the demo
 * mounts. These look like real runtime emits — see
 * .chalk/plans/web-inspector-v1.md §7.3 for the envelope contract.
 */
const SEED_EVENTS: TimelineEvent[] = [
  {
    id: "seed:0",
    at: isoMinusMinutes(7),
    tool: "render_stock_chart",
    args: { ticker: "AAPL", range: "5Y" },
    agent: "default",
    thread: "t_abc",
    status: "ok",
    result: { rendered: true },
  },
  {
    id: "seed:1",
    at: isoMinusMinutes(5),
    tool: "user_form",
    args: { name: "Ada", email: "ada@example.com" },
    agent: "default",
    thread: "t_abc",
    status: "ok",
  },
  {
    id: "seed:2",
    at: isoMinusMinutes(4),
    tool: "render_stock_chart",
    args: { ticker: "MSFT", range: "1M" },
    agent: "default",
    thread: "t_abc",
    status: "error",
    error: "Failed to fetch quote: rate limited",
  },
  {
    id: "seed:3",
    at: isoMinusMinutes(2),
    tool: "weather_card",
    args: { city: "Brooklyn", units: "F" },
    agent: "default",
    thread: "t_abc",
    status: "ok",
  },
  {
    id: "seed:4",
    at: isoMinusMinutes(1),
    tool: "render_stock_chart",
    args: { ticker: "NVDA", range: "1M" },
    agent: "default",
    thread: "t_abc",
    status: "pending",
  },
];

export function TimelineDemo(): ReactElement {
  const [events, setEvents] = useState<TimelineEvent[]>(SEED_EVENTS);
  const [connected, setConnected] = useState(true);
  const [selectedTool, setSelectedTool] = useState<string | null>(
    "render_stock_chart",
  );
  const [filter, setFilter] = useState<TimelineFilter>({ mode: "all" });
  const [log, setLog] = useState<string[]>([]);
  // Counter lives in a ref so burst-mode setInterval doesn't trip on
  // stale-closure / batching — each tick reads-then-writes the latest value
  // without waiting for a render commit.
  const counterRef = useRef(SEED_EVENTS.length);

  const handleReproduce = useCallback((event: TimelineEvent) => {
    setLog((prev) =>
      [
        `reproduce → ${event.tool}: ${stringifyShort(event.args)}`,
        ...prev,
      ].slice(0, 12),
    );
  }, []);

  const emit = useCallback((envelope: DebugEventEnvelope) => {
    setEvents((prev) => reduceTimeline(prev, envelope));
  }, []);

  const emitInvoked = useCallback(
    (tool: string) => {
      counterRef.current += 1;
      const id = counterRef.current;
      const invocationId = `demo-${id}`;
      const at = new Date().toISOString();
      emit({
        timestamp: Date.now(),
        agentId: "default",
        threadId: "t_demo",
        runId: `run-${id}`,
        event: {
          type: "frontend_tool.invoked",
          name: tool,
          args: sampleArgsFor(tool, id),
          agent: "default",
          thread: "t_demo",
          at,
          invocationId,
        },
      });
      // Schedule a result event so users see the pending → ok lifecycle.
      const ok = id % 4 !== 0; // every 4th invocation errors
      setTimeout(() => {
        emit({
          timestamp: Date.now(),
          agentId: "default",
          threadId: "t_demo",
          runId: `run-${id}`,
          event: ok
            ? {
                type: "frontend_tool.result",
                name: tool,
                result: { rendered: true, durationMs: 142 },
                agent: "default",
                thread: "t_demo",
                at: new Date().toISOString(),
                invocationId,
              }
            : {
                type: "frontend_tool.result",
                name: tool,
                error: "Synthetic failure (demo)",
                agent: "default",
                thread: "t_demo",
                at: new Date().toISOString(),
                invocationId,
              },
        });
      }, 600);
    },
    [emit],
  );

  const emitRandom = useCallback(() => {
    const tool = DEMO_TOOLS[Math.floor(Math.random() * DEMO_TOOLS.length)];
    emitInvoked(tool);
  }, [emitInvoked]);

  // Burst mode — useful to verify virtualization without manual clicking.
  // 20 events at ~200ms apart; spacing is wide enough to survive React 19's
  // automatic batching + dev StrictMode without coalescing into a few
  // updates.
  const emitBurst = useCallback(() => {
    let i = 0;
    const id = window.setInterval(() => {
      emitRandom();
      i += 1;
      if (i >= 20) window.clearInterval(id);
    }, 200);
  }, [emitRandom]);

  const clearEvents = useCallback(() => setEvents([]), []);

  // Keep filter.selectedTool in sync with the demo's selected component.
  // Mirrors what App.tsx will do in M7.
  const filterWithSelection = useMemo<TimelineFilter>(() => {
    if (filter.mode === "selected" && selectedTool) {
      return { mode: "selected", selectedTool };
    }
    return filter;
  }, [filter, selectedTool]);

  return (
    <div style={demoStyles.shell}>
      <header style={demoStyles.header}>
        <h1 style={demoStyles.title}>Timeline drawer · demo</h1>
        <span style={demoStyles.sub}>
          Standalone harness — exercises every prop the M7 integration will
          drive. Press <kbd style={demoStyles.kbd}>⌘J</kbd> /{" "}
          <kbd style={demoStyles.kbd}>Ctrl+J</kbd> to toggle.
        </span>
      </header>

      <section style={demoStyles.controls}>
        <fieldset style={demoStyles.fieldset}>
          <legend>Runtime</legend>
          <label style={demoStyles.checkLabel}>
            <input
              type="checkbox"
              checked={connected}
              onChange={(e) => setConnected(e.target.checked)}
            />
            Connected
          </label>
        </fieldset>

        <fieldset style={demoStyles.fieldset}>
          <legend>Selected component</legend>
          <select
            value={selectedTool ?? ""}
            onChange={(e) => setSelectedTool(e.target.value || null)}
            style={demoStyles.select}
          >
            <option value="">(none)</option>
            {DEMO_TOOLS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset style={demoStyles.fieldset}>
          <legend>Emit synthetic event</legend>
          <div style={demoStyles.buttonRow}>
            {DEMO_TOOLS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => emitInvoked(t)}
                style={demoStyles.button}
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              onClick={emitRandom}
              style={{ ...demoStyles.button, ...demoStyles.buttonAccent }}
            >
              random
            </button>
            <button
              type="button"
              onClick={emitBurst}
              style={demoStyles.button}
              title="20 events × 200ms — verifies virtualization without batching artifacts"
            >
              burst (20×200ms)
            </button>
            <button
              type="button"
              onClick={clearEvents}
              style={demoStyles.button}
            >
              clear
            </button>
          </div>
        </fieldset>

        <fieldset style={{ ...demoStyles.fieldset, flex: 1 }}>
          <legend>Reproduce log</legend>
          <ol style={demoStyles.log}>
            {log.length === 0 ? (
              <li style={demoStyles.logEmpty}>
                Click <kbd style={demoStyles.kbd}>↩ Reproduce</kbd> on a row.
              </li>
            ) : (
              log.map((line, i) => (
                <li key={`${i}-${line}`} style={demoStyles.logLine}>
                  {line}
                </li>
              ))
            )}
          </ol>
        </fieldset>
      </section>

      <main style={demoStyles.canvas}>
        <div style={demoStyles.canvasNote}>
          The three-column area (Components · Sandbox · Args) ships in M2/M3/M4.
          The drawer below is what M5 owns.
        </div>
      </main>

      <footer style={demoStyles.drawer}>
        <Timeline
          events={events}
          connected={connected}
          onReproduce={handleReproduce}
          filter={filterWithSelection}
          onFilterChange={setFilter}
          selectedTool={selectedTool}
        />
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoMinusMinutes(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function stringifyShort(args: unknown): string {
  try {
    const json = JSON.stringify(args);
    if (json.length <= 60) return json;
    return json.slice(0, 59) + "…";
  } catch {
    return String(args);
  }
}

function sampleArgsFor(tool: string, seed: number): unknown {
  switch (tool) {
    case "render_stock_chart":
      return {
        ticker: pick(["AAPL", "MSFT", "NVDA", "META", "AMZN"], seed),
        range: pick(["1D", "1M", "1Y", "5Y"], seed + 1),
      };
    case "user_form":
      return {
        name: pick(["Ada", "Grace", "Linus", "Margaret"], seed),
        email: `user${seed}@example.com`,
      };
    case "weather_card":
      return {
        city: pick(["Brooklyn", "Lisbon", "Tokyo", "Reykjavík"], seed),
        units: pick(["F", "C"], seed),
      };
    case "pricing_table":
      return { tier: pick(["free", "pro", "team", "enterprise"], seed) };
    case "render_a2ui":
      return {
        surface: pick(["card", "list", "form"], seed),
        data: { rows: seed },
      };
    default:
      return { seed };
  }
}

function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(seed) % list.length];
}

// ---------------------------------------------------------------------------
// Demo-only styles — kept separate from the timeline's own styles so the
// component stays free of "demo chrome" CSS.
// ---------------------------------------------------------------------------

const demoStyles: Record<string, CSSProperties> = {
  shell: {
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    color: "#111",
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    backgroundColor: "#fafafa",
  },
  header: {
    padding: "1rem 1.5rem 0.5rem",
    borderBottom: "1px solid #e3e3e3",
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 18,
    margin: 0,
    fontWeight: 600,
  },
  sub: {
    fontSize: 12,
    color: "#666",
  },
  controls: {
    display: "flex",
    gap: "0.75rem",
    padding: "0.75rem 1.5rem",
    backgroundColor: "#fff",
    borderBottom: "1px solid #e3e3e3",
    flexWrap: "wrap",
    alignItems: "stretch",
  },
  fieldset: {
    border: "1px solid #e3e3e3",
    borderRadius: 6,
    padding: "0.5rem 0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    minWidth: 200,
  },
  checkLabel: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: 13,
  },
  select: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    padding: "0.25rem 0.5rem",
    borderRadius: 4,
    border: "1px solid #cdcdcd",
  },
  buttonRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.25rem",
  },
  button: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    padding: "0.25rem 0.5rem",
    borderRadius: 4,
    border: "1px solid #cdcdcd",
    backgroundColor: "#fff",
    cursor: "pointer",
  },
  buttonAccent: {
    backgroundColor: "#e7f3ec",
    borderColor: "#0a6f3f",
    color: "#0a6f3f",
    fontWeight: 600,
  },
  log: {
    margin: 0,
    paddingLeft: "1rem",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    color: "#1f1f1f",
    maxHeight: 120,
    overflow: "auto",
  },
  logLine: {
    listStyle: "decimal",
    margin: "0.125rem 0",
  },
  logEmpty: {
    color: "#888",
    fontStyle: "italic",
    listStyle: "none",
    marginLeft: "-1rem",
  },
  canvas: {
    flex: 1,
    padding: "1.5rem",
    backgroundColor: "#fafafa",
    color: "#666",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  canvasNote: {
    border: "1px dashed #cdcdcd",
    borderRadius: 8,
    padding: "1.5rem 2rem",
    fontSize: 13,
    textAlign: "center",
    maxWidth: 480,
    backgroundColor: "#fff",
  },
  drawer: {
    flexShrink: 0,
  },
  kbd: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    border: "1px solid #cdcdcd",
    borderRadius: 3,
    padding: "0px 4px",
    backgroundColor: "#fff",
  },
};
