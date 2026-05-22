/**
 * CopilotKit Studio — top-level integration (M7).
 *
 * Wires together every Wave-2 component on a single page:
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ Header  runtime: localhost:3000 • Components: N • status pips  │
 *   ├──────────────┬─────────────────────────────┬───────────────────┤
 *   │ COMPONENTS   │   <SandboxFrame>            │ <ArgForm>         │
 *   │ (left rail)  │   (center)                  │ <FixturePresets>  │
 *   ├──────────────┴─────────────────────────────┴───────────────────┤
 *   │ <Timeline> (bottom drawer, Cmd+J)                              │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * State is plain `useState` / `useMemo` / `useEffect` — no extra library. The
 * key pieces of state and their owners:
 *
 *   - `tools`              — broadcast from the launcher over its WebSocket.
 *   - `selectedToolName`   — driven by URL `?tool=` and clicks in the rail.
 *   - `argsByTool`         — per-tool form state; the form (right panel) and
 *                            the sandbox (center) both read from the entry
 *                            for the currently-selected tool. Persists across
 *                            tool switches so the dev can jump around without
 *                            losing edits.
 *   - `timelineEvents`     — reduced from the SSE channel by `reduceTimeline`.
 *   - `sseStatus`          — surfaced in the header + timeline drawer.
 *   - `timelineExpanded`   — controlled by `Cmd+J` (handled inside `<Timeline>`).
 *   - `timelineFilter`     — chip state inside the drawer.
 *
 * Deep-link URL params (plan §7.4): `runtime`, `agent`, `thread`, `tool`. We
 * restore `runtime` and `tool` on mount; `agent` and `thread` are surfaced in
 * the header for visibility but otherwise unused until M8.
 *
 * Empty states (plan §5):
 *   - No tools yet → "Are you in a CopilotKit project? Detected root: ..."
 *   - No runtime → "Start your CopilotKit app and we'll subscribe to its
 *     /cpk-debug-events stream."
 *   - No tool selected → "Pick a component from the left to inspect."
 *   - No timeline events → handled inside <Timeline>.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

import { ArgForm, descriptorToDefaults } from "./components/arg-form.js";
import { FixturePresets } from "./components/fixture-presets.js";
import { SandboxFrame } from "./components/sandbox-frame.js";
import { Timeline } from "./components/timeline.js";
import type { TimelineFilter } from "./components/timeline.js";
import { DebugStream, reduceTimeline } from "./lib/sse-client.js";
import type {
  DebugEventEnvelope,
  LauncherCommand,
  LauncherEvent,
  SseConnectionStatus,
  TimelineEvent,
  ToolDescriptor,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STUDIO_TITLE = "CopilotKit Studio";
const TIMELINE_MAX_ENTRIES = 500;
const DEEP_LINK_PARAMS = ["runtime", "agent", "thread", "tool"] as const;

type LauncherStatus = "connecting" | "connected" | "disconnected" | "error";

// Stable, file+name+line key — matches the launcher's `toolKey` so deltas
// reconcile cleanly. The locked `LauncherEvent.registry.delta` uses tool
// names for `removed` so we fall back to name when applying removals.
const toolKey = (t: ToolDescriptor): string =>
  `${t.filePath}::${t.name}::${t.loc.line}`;

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

type DeepLinkParams = {
  runtime: string | null;
  agent: string | null;
  thread: string | null;
  tool: string | null;
};

function readDeepLinkParams(): DeepLinkParams {
  const out: DeepLinkParams = {
    runtime: null,
    agent: null,
    thread: null,
    tool: null,
  };
  if (typeof window === "undefined") return out;
  const search = new URLSearchParams(window.location.search);
  for (const key of DEEP_LINK_PARAMS) {
    const value = search.get(key);
    if (value && value.length > 0) out[key] = value;
  }
  return out;
}

function buildWsUrl(): string {
  // The launcher serves the SPA and the WebSocket on the same origin, so we
  // can lift host+port off `window.location`.
  const { hostname, port } = window.location;
  return `ws://${hostname}:${port}/__inspector/ws`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function App(): ReactElement {
  const initialParams = useMemo<DeepLinkParams>(() => readDeepLinkParams(), []);

  // Launcher state
  const [launcherStatus, setLauncherStatus] =
    useState<LauncherStatus>("connecting");
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [rootDir, setRootDir] = useState<string | null>(null);
  const [scannedFiles, setScannedFiles] = useState<number | null>(null);
  const [scanErrors, setScanErrors] = useState<
    { filePath: string; message: string; at: string }[]
  >([]);

  // Runtime / SSE state
  const [runtimeUrl, setRuntimeUrl] = useState<string>(
    initialParams.runtime ?? "",
  );
  const [runtimeUrlDraft, setRuntimeUrlDraft] = useState<string>(
    initialParams.runtime ?? "",
  );
  const [sseStatus, setSseStatus] =
    useState<SseConnectionStatus>("disconnected");
  const [sseError, setSseError] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(
    initialParams.agent,
  );
  const [activeThread, setActiveThread] = useState<string | null>(
    initialParams.thread,
  );

  // Selection / form state
  const [selectedToolName, setSelectedToolName] = useState<string | null>(
    initialParams.tool ?? null,
  );
  const [argsByTool, setArgsByTool] = useState<Map<string, unknown>>(new Map());

  // Timeline drawer state
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>({
    mode: "all",
  });

  // Theme is plumbed through to the sandbox iframe for parity with the popup
  // inspector. v1 ships light only; M8 polish wires up a real theme toggle.
  const theme: "light" | "dark" = "light";

  // ---------------------------------------------------------------------------
  // Launcher WebSocket
  // ---------------------------------------------------------------------------

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const url = buildWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener("open", () => setLauncherStatus("connected"));
    ws.addEventListener("close", () => setLauncherStatus("disconnected"));
    ws.addEventListener("error", () => setLauncherStatus("error"));
    ws.addEventListener("message", (ev) => {
      let parsed: LauncherEvent;
      try {
        parsed = JSON.parse(ev.data as string) as LauncherEvent;
      } catch {
        return;
      }
      handleLauncherEvent(parsed);
    });

    return () => {
      wsRef.current = null;
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLauncherEvent = useCallback((event: LauncherEvent): void => {
    switch (event.type) {
      case "workspace.ready":
        setRootDir(event.rootDir);
        setScannedFiles(event.scannedFiles);
        break;
      case "registry.snapshot":
        setTools(event.tools);
        break;
      case "registry.delta":
        setTools((prev) => applyRegistryDelta(prev, event));
        break;
      case "fixture.changed":
        // Patch any tool whose fixtures map matches. The launcher also
        // broadcasts a registry.snapshot refresh under the covers, but
        // applying here too keeps the UI snappy without an extra round-trip.
        setTools((prev) =>
          prev.map((t) =>
            event.tools.includes(t.name)
              ? { ...t, fixturePath: event.filePath, fixtures: event.fixtures }
              : t,
          ),
        );
        break;
      case "scan.error":
        setScanErrors((prev) => {
          // Keep the last 10 — older errors page off as the user iterates.
          const next = [
            ...prev,
            {
              filePath: event.filePath,
              message: event.message,
              at: event.at,
            },
          ];
          return next.slice(-10);
        });
        break;
      default:
        break;
    }
  }, []);

  const sendLauncherCommand = useCallback((command: LauncherCommand): void => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Launcher is gone — log and bail. The user will see the launcher pip
      // turn red; the next reconnect (manual page refresh in v1) will fix it.
      console.warn(
        "[studio] dropped command: launcher WebSocket is not open",
        command,
      );
      return;
    }
    ws.send(JSON.stringify(command));
  }, []);

  // ---------------------------------------------------------------------------
  // SSE timeline subscription
  // ---------------------------------------------------------------------------

  const streamRef = useRef<DebugStream | null>(null);

  useEffect(() => {
    // Reset any prior stream when the URL changes.
    if (streamRef.current) {
      streamRef.current.dispose();
      streamRef.current = null;
    }
    if (!runtimeUrl) {
      setSseStatus("disconnected");
      return;
    }

    const stream = new DebugStream();
    streamRef.current = stream;

    const unsubscribeStatus = stream.onStatus((status) => setSseStatus(status));
    const unsubscribeError = stream.onError((message) => setSseError(message));
    const unsubscribeEvent = stream.onEvent((envelope) => {
      // Header context: surface the latest agent/thread the runtime reports.
      const event = envelope.event;
      if (event.type === "agent.thread.changed") {
        const changed = event as Extract<
          DebugEventEnvelope["event"],
          { type: "agent.thread.changed" }
        >;
        setActiveAgent(changed.agent);
        setActiveThread(changed.thread);
      }

      setTimelineEvents((prev) =>
        reduceTimeline(prev, envelope, { maxEntries: TIMELINE_MAX_ENTRIES }),
      );
    });

    stream.connect(runtimeUrl);

    return () => {
      unsubscribeStatus();
      unsubscribeError();
      unsubscribeEvent();
      stream.dispose();
      streamRef.current = null;
    };
  }, [runtimeUrl]);

  // ---------------------------------------------------------------------------
  // Selection bookkeeping
  // ---------------------------------------------------------------------------

  const selectedTool = useMemo<ToolDescriptor | null>(() => {
    if (!selectedToolName) return null;
    return tools.find((t) => t.name === selectedToolName) ?? null;
  }, [tools, selectedToolName]);

  // If the URL had `?tool=<name>` but the registry hadn't loaded yet, the
  // selection is "pending". When the registry arrives and the tool exists, we
  // already have a match; if it doesn't exist, fall back to the first tool so
  // the user isn't staring at an empty center pane. We never auto-deselect a
  // previously-selected tool just because the registry refreshed.
  useEffect(() => {
    if (tools.length === 0) return;
    if (selectedToolName && tools.some((t) => t.name === selectedToolName)) {
      return;
    }
    if (!selectedToolName) {
      // Auto-select only when the URL didn't preselect anything. Letting the
      // user manually pick keeps the empty-center hint visible during the
      // first session — but if the URL already named a tool that does exist
      // we never hit this branch.
      return;
    }
    // URL named a tool that the launcher didn't find. Surface as a soft hint
    // by clearing the selection — the empty center pane explains the state.
    setSelectedToolName(null);
  }, [tools, selectedToolName]);

  // Seed defaults the first time a tool is selected. We keep prior edits when
  // the user revisits — the form state is sticky across selections.
  useEffect(() => {
    if (!selectedTool) return;
    setArgsByTool((prev) => {
      if (prev.has(selectedTool.name)) return prev;
      const next = new Map(prev);
      next.set(
        selectedTool.name,
        descriptorToDefaults(selectedTool.parameters),
      );
      return next;
    });
  }, [selectedTool]);

  const currentArgs = useMemo<unknown>(() => {
    if (!selectedTool) return undefined;
    return argsByTool.get(selectedTool.name);
  }, [argsByTool, selectedTool]);

  const updateArgsForSelected = useCallback(
    (nextArgs: unknown): void => {
      setArgsByTool((prev) => {
        if (!selectedToolName) return prev;
        const next = new Map(prev);
        next.set(selectedToolName, nextArgs);
        return next;
      });
    },
    [selectedToolName],
  );

  // ---------------------------------------------------------------------------
  // Fixture preset handlers
  // ---------------------------------------------------------------------------

  const handlePresetApply = useCallback(
    (_presetName: string, presetArgs: unknown): void => {
      updateArgsForSelected(presetArgs);
    },
    [updateArgsForSelected],
  );

  const handlePresetSave = useCallback(
    (presetName: string, presetArgs: unknown): void => {
      if (!selectedTool) return;
      sendLauncherCommand({
        type: "fixture.save",
        toolName: selectedTool.name,
        presetName,
        args: presetArgs,
      });
    },
    [selectedTool, sendLauncherCommand],
  );

  // ---------------------------------------------------------------------------
  // Timeline → form bridge ("Reproduce")
  // ---------------------------------------------------------------------------

  const handleReproduce = useCallback((event: TimelineEvent): void => {
    // Switch selection to the invoked tool. If the launcher hasn't seen
    // the tool (e.g. user picked an example app the agent has but the
    // scanner doesn't), we still try to set the selection so the sandbox
    // attempt surfaces the not-found state instead of silently no-op'ing.
    setSelectedToolName(event.tool);
    setArgsByTool((prev) => {
      const next = new Map(prev);
      next.set(event.tool, event.args);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Header runtime URL editor
  // ---------------------------------------------------------------------------

  const commitRuntimeUrl = useCallback((): void => {
    const trimmed = runtimeUrlDraft.trim();
    if (trimmed === runtimeUrl) return;
    setRuntimeUrl(trimmed);
    // Mirror to the URL so deep-link copy/paste includes the latest runtime.
    if (typeof window !== "undefined") {
      const next = new URL(window.location.href);
      if (trimmed.length === 0) next.searchParams.delete("runtime");
      else next.searchParams.set("runtime", trimmed);
      window.history.replaceState({}, "", next.toString());
    }
  }, [runtimeUrl, runtimeUrlDraft]);

  // Sync URL when selection changes — copyable deep links from the address bar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = new URL(window.location.href);
    if (selectedToolName) next.searchParams.set("tool", selectedToolName);
    else next.searchParams.delete("tool");
    window.history.replaceState({}, "", next.toString());
  }, [selectedToolName]);

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  const sortedTools = useMemo<ToolDescriptor[]>(
    () => [...tools].sort((a, b) => a.name.localeCompare(b.name)),
    [tools],
  );

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>{STUDIO_TITLE}</h1>
          <span style={styles.divider} aria-hidden="true">
            •
          </span>
          <RuntimeUrlEditor
            value={runtimeUrlDraft}
            onChange={setRuntimeUrlDraft}
            onCommit={commitRuntimeUrl}
            status={sseStatus}
          />
          {activeAgent ? (
            <>
              <span style={styles.divider} aria-hidden="true">
                •
              </span>
              <span style={styles.metaInline}>
                agent: <code style={styles.code}>{activeAgent}</code>
              </span>
            </>
          ) : null}
          {activeThread ? (
            <>
              <span style={styles.divider} aria-hidden="true">
                •
              </span>
              <span style={styles.metaInline}>
                thread: <code style={styles.code}>{activeThread}</code>
              </span>
            </>
          ) : null}
        </div>
        <div style={styles.headerRight}>
          <StatusDot
            label="launcher"
            color={launcherPipColor(launcherStatus)}
            tooltip={`Launcher ${launcherStatus}`}
          />
          <StatusDot
            label="runtime"
            color={ssePipColor(sseStatus, runtimeUrl)}
            tooltip={`Runtime SSE: ${runtimeUrl ? sseStatus : "no URL"}`}
          />
          <span style={styles.metaInline}>
            Components: <strong>{tools.length}</strong>
          </span>
          {/* Settings cog is a v1.5 placeholder per the brief. */}
          <button
            type="button"
            style={styles.settingsButton}
            aria-label="Settings (v1.5 — coming soon)"
            title="Settings (v1.5 — coming soon)"
            disabled
          >
            ⚙
          </button>
        </div>
      </header>

      {scanErrors.length > 0 ? (
        <div style={styles.scanErrorBanner} role="status">
          <strong style={styles.scanErrorTitle}>
            Scan issues ({scanErrors.length})
          </strong>
          <ul style={styles.scanErrorList}>
            {scanErrors.slice(-3).map((err) => (
              <li
                key={`${err.at}::${err.filePath}`}
                style={styles.scanErrorRow}
              >
                <code style={styles.scanErrorPath}>
                  {truncateMiddle(err.filePath, 64)}
                </code>{" "}
                — {err.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <main style={styles.main}>
        <aside style={styles.componentsRail} aria-label="Components">
          <h2 style={styles.railTitle}>Components</h2>
          {tools.length === 0 ? (
            <ComponentsRailEmpty
              launcherStatus={launcherStatus}
              rootDir={rootDir}
              scannedFiles={scannedFiles}
            />
          ) : (
            <ul style={styles.componentList}>
              {sortedTools.map((tool) => {
                const isActive = tool.name === selectedToolName;
                return (
                  <li key={toolKey(tool)}>
                    <button
                      type="button"
                      style={{
                        ...styles.componentButton,
                        ...(isActive ? styles.componentButtonActive : null),
                      }}
                      onClick={() => setSelectedToolName(tool.name)}
                      title={tool.filePath}
                    >
                      <span
                        style={{
                          ...styles.componentDot,
                          background: isActive ? "#0a6f3f" : "#cdcdcd",
                        }}
                        aria-hidden="true"
                      />
                      <span style={styles.componentName}>{tool.name}</span>
                      <span style={styles.componentHook}>{tool.hook}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section style={styles.centerColumn} aria-label="Sandbox">
          {selectedTool ? (
            runtimeUrl ? (
              <SandboxFrame
                runtimeUrl={runtimeUrl}
                tool={selectedTool}
                args={currentArgs}
                theme={theme}
              />
            ) : (
              <SandboxRuntimeMissing
                selectedToolName={selectedTool.name}
                onSetRuntime={(value) => {
                  setRuntimeUrlDraft(value);
                  setRuntimeUrl(value);
                }}
              />
            )
          ) : (
            <CenterEmpty hasTools={tools.length > 0} />
          )}
          {selectedTool ? (
            <div style={styles.sandboxFooter}>
              <code style={styles.sandboxPath}>
                {truncateMiddle(selectedTool.filePath, 80)}:
                {selectedTool.loc.line}
              </code>
              {selectedTool.description ? (
                <span style={styles.sandboxDescription}>
                  {selectedTool.description}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        <aside style={styles.rightColumn} aria-label="Args and presets">
          {selectedTool ? (
            <>
              <section style={styles.panel}>
                <h2 style={styles.panelTitle}>Args</h2>
                <ArgForm
                  parameters={selectedTool.parameters}
                  value={currentArgs}
                  onChange={updateArgsForSelected}
                />
              </section>
              <FixturePresets
                tool={selectedTool}
                currentArgs={currentArgs}
                onApply={handlePresetApply}
                onSave={handlePresetSave}
              />
            </>
          ) : (
            <RightEmpty />
          )}
        </aside>
      </main>

      <footer style={styles.footer}>
        <Timeline
          events={timelineEvents}
          connected={sseStatus === "connected"}
          onReproduce={handleReproduce}
          filter={timelineFilter}
          onFilterChange={setTimelineFilter}
          expanded={timelineExpanded}
          onExpandedChange={setTimelineExpanded}
          selectedTool={selectedToolName}
        />
      </footer>

      {sseError ? (
        <div style={styles.sseErrorToast} role="alert">
          SSE: {truncate(sseError, 160)}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RuntimeUrlEditor({
  value,
  onChange,
  onCommit,
  status,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  status: SseConnectionStatus;
}): ReactElement {
  return (
    <span style={styles.runtimeRow}>
      <span style={styles.metaLabel}>runtime:</span>
      <input
        type="url"
        spellCheck={false}
        placeholder="http://localhost:3000"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        onBlur={onCommit}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            (ev.currentTarget as HTMLInputElement).blur();
          }
        }}
        style={styles.runtimeInput}
        aria-label="Runtime URL"
      />
      <span style={styles.runtimeStatus} aria-live="polite">
        {sseStatusLabel(status, value)}
      </span>
    </span>
  );
}

function StatusDot({
  label,
  color,
  tooltip,
}: {
  label: string;
  color: string;
  tooltip: string;
}): ReactElement {
  return (
    <span style={styles.statusPair} title={tooltip}>
      <span
        style={{ ...styles.statusDot, background: color }}
        aria-hidden="true"
      />
      <span style={styles.statusLabel}>{label}</span>
    </span>
  );
}

function ComponentsRailEmpty({
  launcherStatus,
  rootDir,
  scannedFiles,
}: {
  launcherStatus: LauncherStatus;
  rootDir: string | null;
  scannedFiles: number | null;
}): ReactElement {
  if (launcherStatus === "connecting") {
    return <p style={styles.railEmpty}>Connecting to launcher...</p>;
  }
  if (launcherStatus === "disconnected" || launcherStatus === "error") {
    return (
      <p style={styles.railEmpty}>
        Lost connection to the launcher. Is <code>npx @copilotkit/studio</code>{" "}
        still running?
      </p>
    );
  }
  return (
    <div style={styles.railEmptyBlock}>
      <p style={styles.railEmpty}>
        No <code>useCopilotAction</code> / <code>useRenderTool</code> call sites
        found.
      </p>
      <p style={styles.railEmptyHint}>
        Are you in a CopilotKit project?
        {rootDir ? (
          <>
            {" "}
            Detected root:{" "}
            <code style={styles.code}>{truncateMiddle(rootDir, 56)}</code>
          </>
        ) : null}
        {scannedFiles !== null ? (
          <>
            {" "}
            Scanned <strong>{scannedFiles}</strong>{" "}
            {scannedFiles === 1 ? "file" : "files"}.
          </>
        ) : null}
      </p>
      <p style={styles.railEmptyHint}>
        Override with <code>--root &lt;path&gt;</code> when launching.
      </p>
    </div>
  );
}

function CenterEmpty({ hasTools }: { hasTools: boolean }): ReactElement {
  return (
    <div style={styles.centerEmpty}>
      <strong style={styles.centerEmptyTitle}>
        {hasTools ? "Pick a component" : "Waiting for components"}
      </strong>
      <p style={styles.centerEmptyHint}>
        {hasTools
          ? "Click an entry on the left to render it in the sandbox."
          : "The launcher hasn't reported any tools yet — once the scanner finishes you'll see them on the left."}
      </p>
    </div>
  );
}

function SandboxRuntimeMissing({
  selectedToolName,
  onSetRuntime,
}: {
  selectedToolName: string;
  onSetRuntime: (next: string) => void;
}): ReactElement {
  return (
    <div style={styles.centerEmpty}>
      <strong style={styles.centerEmptyTitle}>
        Runtime URL not configured
      </strong>
      <p style={styles.centerEmptyHint}>
        Start your CopilotKit app and the studio will subscribe to its{" "}
        <code>/cpk-debug-events</code> stream. Set the runtime URL in the header
        (or pass <code>--runtime</code> when launching) to render{" "}
        <strong>{selectedToolName}</strong> in the sandbox.
      </p>
      <button
        type="button"
        style={styles.centerEmptyButton}
        onClick={() => onSetRuntime("http://localhost:3000")}
      >
        Try <code>http://localhost:3000</code>
      </button>
    </div>
  );
}

function RightEmpty(): ReactElement {
  return (
    <div style={styles.rightEmpty}>
      <strong style={styles.rightEmptyTitle}>Args panel</strong>
      <p style={styles.rightEmptyHint}>
        Select a component on the left to edit its args and pick from any
        sibling <code>*.fixture.json</code> presets.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Apply a `registry.delta` event to the current list of tools. Removals
 * address tools by their `name` (per the locked wire protocol §7.2), so two
 * tools with the same name across different files would both be removed by a
 * delta — matching the launcher's `removed: string[]` semantics. Modifications
 * are keyed by file+name+line so renames at the same line are an idempotent
 * replace, not a remove+add pair.
 */
function applyRegistryDelta(
  prev: ToolDescriptor[],
  delta: Extract<LauncherEvent, { type: "registry.delta" }>,
): ToolDescriptor[] {
  const removedNames = new Set(delta.removed);
  const modifiedKeys = new Set(delta.modified.map(toolKey));
  const kept = prev.filter(
    (t) => !removedNames.has(t.name) && !modifiedKeys.has(toolKey(t)),
  );
  return [...kept, ...delta.modified, ...delta.added];
}

function launcherPipColor(status: LauncherStatus): string {
  switch (status) {
    case "connected":
      return "#0a6f3f"; // green
    case "connecting":
      return "#a06a00"; // amber
    case "disconnected":
    case "error":
    default:
      return "#b22222"; // red
  }
}

function ssePipColor(status: SseConnectionStatus, runtimeUrl: string): string {
  if (!runtimeUrl) return "#9ca3af"; // gray — no URL set
  switch (status) {
    case "connected":
      return "#0a6f3f";
    case "connecting":
      return "#a06a00";
    case "disconnected":
    case "error":
    default:
      return "#b22222";
  }
}

function sseStatusLabel(
  status: SseConnectionStatus,
  runtimeUrl: string,
): string {
  if (!runtimeUrl) return "(set a URL)";
  switch (status) {
    case "connected":
      return "● connected";
    case "connecting":
      return "○ connecting...";
    case "disconnected":
      return "○ disconnected";
    case "error":
      return "● error";
    default:
      return status;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function truncateMiddle(input: string, max: number): string {
  if (input.length <= max) return input;
  const ellipsis = "...";
  const half = Math.floor((max - ellipsis.length) / 2);
  return `${input.slice(0, half)}${ellipsis}${input.slice(input.length - half)}`;
}

// ---------------------------------------------------------------------------
// Styles — inline objects to match the existing Wave-2 convention. Tailwind
// plumbing is M8 polish; keeping styles co-located here makes the shell
// trivially replaceable without churning component contracts.
// ---------------------------------------------------------------------------

const FONT_SANS =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const styles: Record<string, CSSProperties> = {
  shell: {
    fontFamily: FONT_SANS,
    color: "#111",
    minHeight: "100vh",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#f6f7f8",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.625rem 1rem",
    background: "#fff",
    borderBottom: "1px solid #e5e7eb",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    minWidth: 0,
    flex: 1,
    flexWrap: "wrap",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexShrink: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    margin: 0,
    letterSpacing: -0.1,
  },
  divider: {
    color: "#cdcdcd",
    fontSize: 12,
  },
  runtimeRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
  },
  metaLabel: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaInline: {
    fontFamily: FONT_MONO,
    fontSize: 12,
    color: "#374151",
  },
  runtimeInput: {
    fontFamily: FONT_MONO,
    fontSize: 12,
    padding: "0.25rem 0.5rem",
    border: "1px solid #d4d4d8",
    borderRadius: 4,
    minWidth: 220,
    background: "#fff",
    color: "#111",
  },
  runtimeStatus: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: "#666",
  },
  statusPair: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    display: "inline-block",
  },
  statusLabel: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  code: {
    fontFamily: FONT_MONO,
    background: "#f3f4f6",
    padding: "0.1rem 0.3rem",
    borderRadius: 3,
    fontSize: 11,
    color: "#374151",
  },
  settingsButton: {
    appearance: "none",
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#9ca3af",
    cursor: "not-allowed",
    width: 28,
    height: 28,
    borderRadius: 4,
    fontSize: 14,
  },
  scanErrorBanner: {
    margin: "0.5rem 1rem",
    padding: "0.5rem 0.75rem",
    border: "1px solid #f0c5c5",
    background: "#fff5f5",
    borderRadius: 6,
    fontFamily: FONT_SANS,
    fontSize: 12,
    color: "#7c2d2d",
  },
  scanErrorTitle: {
    display: "block",
    fontWeight: 600,
    marginBottom: 4,
  },
  scanErrorList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  scanErrorRow: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: "#7c2d2d",
  },
  scanErrorPath: {
    color: "#7c2d2d",
    fontFamily: FONT_MONO,
  },
  main: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "260px 1fr 320px",
    gridTemplateRows: "1fr",
    gap: "0.625rem",
    padding: "0.625rem 1rem",
    boxSizing: "border-box",
    overflow: "hidden",
  },
  componentsRail: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "0.75rem",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  railTitle: {
    fontSize: 11,
    fontWeight: 600,
    margin: 0,
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  componentList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  componentButton: {
    appearance: "none",
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.4rem 0.5rem",
    border: "1px solid transparent",
    borderRadius: 6,
    background: "transparent",
    cursor: "pointer",
    color: "#111",
    textAlign: "left",
    fontFamily: FONT_MONO,
    fontSize: 12.5,
  },
  componentButtonActive: {
    background: "#e7f3ec",
    borderColor: "#bfe1ca",
  },
  componentDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    flexShrink: 0,
  },
  componentName: {
    color: "#111",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  },
  componentHook: {
    fontFamily: FONT_MONO,
    fontSize: 10.5,
    color: "#7755aa",
    background: "#f4eefa",
    padding: "0 0.3rem",
    borderRadius: 3,
    border: "1px solid #e6d6f5",
    flexShrink: 0,
  },
  centerColumn: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "0.75rem",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  },
  sandboxFooter: {
    marginTop: "0.5rem",
    display: "flex",
    alignItems: "baseline",
    gap: "0.75rem",
    fontSize: 11,
    color: "#555",
    flexShrink: 0,
    overflow: "hidden",
  },
  sandboxPath: {
    fontFamily: FONT_MONO,
    color: "#374151",
    background: "#f3f4f6",
    padding: "0.1rem 0.35rem",
    borderRadius: 3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  sandboxDescription: {
    color: "#6b7280",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  },
  rightColumn: {
    display: "flex",
    flexDirection: "column",
    gap: "0.625rem",
    overflow: "auto",
    minWidth: 0,
  },
  panel: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "0.75rem",
  },
  panelTitle: {
    fontSize: 11,
    fontWeight: 600,
    margin: "0 0 0.5rem 0",
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  railEmpty: {
    margin: 0,
    fontSize: 12.5,
    color: "#555",
    fontStyle: "italic",
    lineHeight: 1.5,
  },
  railEmptyBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  railEmptyHint: {
    margin: 0,
    fontSize: 11.5,
    color: "#6b7280",
    lineHeight: 1.5,
  },
  centerEmpty: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    color: "#6b7280",
    textAlign: "center",
    padding: "2rem",
  },
  centerEmptyTitle: {
    fontSize: 14,
    color: "#111",
  },
  centerEmptyHint: {
    margin: 0,
    fontSize: 12.5,
    color: "#6b7280",
    maxWidth: 420,
    lineHeight: 1.6,
  },
  centerEmptyButton: {
    appearance: "none",
    border: "1px solid #d4d4d8",
    background: "#fff",
    color: "#111",
    padding: "0.4rem 0.75rem",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontFamily: FONT_MONO,
  },
  rightEmpty: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  rightEmptyTitle: {
    fontSize: 13,
    color: "#111",
  },
  rightEmptyHint: {
    margin: 0,
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 1.5,
  },
  footer: {
    background: "#fff",
    borderTop: "1px solid #e5e7eb",
    flexShrink: 0,
  },
  sseErrorToast: {
    position: "fixed",
    bottom: "4rem",
    right: "1rem",
    background: "#fff5f5",
    border: "1px solid #f0c5c5",
    color: "#7c2d2d",
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
    fontSize: 12,
    maxWidth: 380,
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
    fontFamily: FONT_MONO,
  },
};
