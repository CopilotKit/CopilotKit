/**
 * CopilotKit Studio — Timeline drawer (M5).
 *
 * Bottom drawer per .chalk/plans/web-inspector-v1.md §5:
 *
 *   Collapsed:   ▸ TIMELINE • N events • most recent: HH:MM tool_name
 *   Expanded:    ▾ TIMELINE • N events • filter: [all | selected]
 *                <virtualized list>
 *                HH:MM:SS  tool  args-preview  [↩ Reproduce]
 *
 * Behavior:
 *   - `Cmd+J` (or `Ctrl+J` on non-mac) toggles expand/collapse, mirroring the
 *     VS Code / Chrome DevTools convention.
 *   - New events flash the strip when collapsed; the drawer never
 *     auto-expands (avoids layout shift while the user is doing something
 *     else).
 *   - Filter chip toggles "all" / "selected" — the latter narrows to events
 *     whose `tool` matches the currently-selected component.
 *   - `[↩ Reproduce]` invokes `onReproduce(event)` so the consumer (M7) can
 *     hand the args off to the arg form (M4) + the sandbox iframe (M3).
 *   - Empty states: drawer is connected-but-empty → "trigger an interaction
 *     in your running app"; not-connected → "no runtime connected".
 *
 * **Virtualization**: M5 ships a hand-rolled window so we don't pull in a
 * dependency. Renders ~30 rows at most regardless of `events.length`, which
 * matches the drawer's ~30% vertical budget at 16px line-height. If we ever
 * need deeper scroll inertia, drop in `@tanstack/react-virtual` and replace
 * `VirtualList` — the rest of the surface won't notice.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";

import type { TimelineEvent } from "../../shared/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimelineFilter = {
  mode: "all" | "selected";
  /** Required when `mode === "selected"`; the tool name to narrow to. */
  selectedTool?: string;
};

export type TimelineProps = {
  events: TimelineEvent[];
  connected: boolean;
  onReproduce: (event: TimelineEvent) => void;
  filter: TimelineFilter;
  onFilterChange: (next: TimelineFilter) => void;
  /**
   * Optional — when controlled, the consumer drives expand/collapse. When
   * undefined, the drawer manages its own state.
   */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /**
   * Optional — when set, the drawer narrows to events for this tool when
   * filter mode is `selected`. Mirrors `filter.selectedTool` so the consumer
   * can pass either. Used by the demo to keep filter+selection in sync.
   */
  selectedTool?: string | null;
  /** Optional — override the drawer height when expanded. Defaults to 30vh. */
  expandedHeight?: string | number;
  /** Optional — disable the global Cmd+J listener (handy for nested demos). */
  disableShortcut?: boolean;
};

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const ROW_HEIGHT_PX = 32;
const COLLAPSED_HEIGHT = "44px";
const FLASH_DURATION_MS = 700;

// Colors picked to match the M0 SPA's palette (App.tsx) — same neutral
// monospace strip; we layer drawer chrome on top.
const COLORS = {
  border: "#e3e3e3",
  borderStrong: "#cdcdcd",
  surface: "#ffffff",
  surfaceMuted: "#fafafa",
  surfaceHover: "#f3f3f3",
  text: "#1f1f1f",
  textMuted: "#666",
  accent: "#0a6f3f",
  accentSubtle: "#e7f3ec",
  warn: "#a06a00",
  error: "#b22222",
  pending: "#6b7280",
  flash: "#fff4cc",
};

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function Timeline(props: TimelineProps): ReactElement {
  const {
    events,
    connected,
    onReproduce,
    filter,
    onFilterChange,
    expanded: controlledExpanded,
    onExpandedChange,
    selectedTool,
    expandedHeight = "30vh",
    disableShortcut = false,
  } = props;

  // Allow controlled OR uncontrolled expansion — the M7 integration drives
  // it; the standalone demo lets the component own it.
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = useCallback(
    (next: boolean) => {
      if (controlledExpanded === undefined) {
        setInternalExpanded(next);
      }
      onExpandedChange?.(next);
    },
    [controlledExpanded, onExpandedChange],
  );

  // Global Cmd+J / Ctrl+J — matches VS Code / Chrome DevTools.
  useEffect(() => {
    if (disableShortcut) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (!modifier) return;
      if (event.key !== "j" && event.key !== "J") return;
      // Don't steal Cmd+J from text inputs (some browsers use it).
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setExpanded(!expanded);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expanded, setExpanded, disableShortcut]);

  // Apply filter; memoized so the virtualized list's slice is stable across
  // re-renders that don't touch events/filter.
  const filteredEvents = useMemo(() => {
    if (filter.mode === "all") return events;
    const target = filter.selectedTool ?? selectedTool ?? null;
    if (!target) return events;
    return events.filter((e) => e.tool === target);
  }, [events, filter, selectedTool]);

  // New-event flash when collapsed. We track the count we last saw vs. the
  // current count; on increase we set a flash flag that auto-clears.
  const [flashing, setFlashing] = useState(false);
  const lastCountRef = useRef(events.length);
  useEffect(() => {
    if (events.length > lastCountRef.current) {
      // Only flash when collapsed; expanded users already see the row arrive.
      if (!expanded) {
        setFlashing(true);
        const timer = setTimeout(() => setFlashing(false), FLASH_DURATION_MS);
        return () => clearTimeout(timer);
      }
    }
    lastCountRef.current = events.length;
    return undefined;
  }, [events.length, expanded]);

  // Reset the last-count tracker when the user expands so the next collapse
  // doesn't trigger a stale flash.
  useEffect(() => {
    lastCountRef.current = events.length;
  }, [expanded, events.length]);

  const mostRecent = events.length > 0 ? events[events.length - 1] : null;

  const handleStripKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setExpanded(!expanded);
      }
    },
    [expanded, setExpanded],
  );

  return (
    <section
      data-testid="cpk-studio-timeline"
      style={{
        ...styles.shell,
        height: expanded ? expandedHeight : COLLAPSED_HEIGHT,
        backgroundColor: COLORS.surface,
        transition: "height 160ms ease-out",
      }}
      aria-label="Live invocation timeline"
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls="cpk-studio-timeline-body"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleStripKey}
        style={{
          ...styles.strip,
          // Flash the strip itself when collapsed — it's the only visible
          // surface so painting the section underneath does nothing.
          backgroundColor:
            flashing && !expanded ? COLORS.flash : COLORS.surfaceMuted,
          transition: "background-color 700ms ease-out",
        }}
        data-testid="cpk-studio-timeline-strip"
        data-flashing={flashing && !expanded ? "true" : "false"}
      >
        <span style={styles.chevron} aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span style={styles.stripLabel}>TIMELINE</span>
        <span style={styles.stripDot} aria-hidden="true">
          ·
        </span>
        <span style={styles.stripCount}>
          {filteredEvents.length}{" "}
          {filteredEvents.length === 1 ? "event" : "events"}
        </span>

        {expanded ? (
          <FilterChip
            filter={filter}
            onChange={onFilterChange}
            selectedTool={selectedTool ?? filter.selectedTool ?? null}
          />
        ) : (
          <span style={styles.stripRecent}>
            <span style={styles.stripDot} aria-hidden="true">
              ·
            </span>
            {mostRecent ? (
              <>
                most recent:{" "}
                <time style={styles.stripTime}>
                  {formatTime(mostRecent.at)}
                </time>{" "}
                <span style={styles.stripTool}>{mostRecent.tool}</span>
                <StatusDot status={mostRecent.status} />
              </>
            ) : connected ? (
              <span style={styles.muted}>waiting for first invocation...</span>
            ) : (
              <span style={styles.muted}>no runtime connected</span>
            )}
          </span>
        )}

        <span style={styles.spacer} />
        <span style={styles.kbd} aria-hidden="true">
          ⌘J
        </span>
        <ConnectionPip connected={connected} />
      </div>

      {expanded ? (
        <div
          id="cpk-studio-timeline-body"
          style={styles.body}
          data-testid="cpk-studio-timeline-body"
        >
          {filteredEvents.length === 0 ? (
            <EmptyState
              connected={connected}
              filterMode={filter.mode}
              selectedTool={filter.selectedTool ?? selectedTool ?? null}
            />
          ) : (
            <VirtualList
              events={filteredEvents}
              onReproduce={onReproduce}
              rowHeight={ROW_HEIGHT_PX}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internal: filter chip
// ---------------------------------------------------------------------------

function FilterChip({
  filter,
  onChange,
  selectedTool,
}: {
  filter: TimelineFilter;
  onChange: (next: TimelineFilter) => void;
  selectedTool: string | null;
}): ReactElement {
  const onAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange({ mode: "all" });
    },
    [onChange],
  );
  const onSelected = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedTool) return;
      onChange({ mode: "selected", selectedTool });
    },
    [onChange, selectedTool],
  );

  // Render disabled-style "selected" pill when no component is selected so
  // the user understands the option exists but needs a left-rail pick first.
  const selectedDisabled = !selectedTool;

  return (
    <span
      style={styles.filterGroup}
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label="Timeline filter"
    >
      <span style={styles.filterLabel}>filter:</span>
      <button
        type="button"
        onClick={onAll}
        style={{
          ...styles.filterPill,
          ...(filter.mode === "all" ? styles.filterPillActive : null),
        }}
        aria-pressed={filter.mode === "all"}
        data-testid="cpk-studio-timeline-filter-all"
      >
        all
      </button>
      <button
        type="button"
        onClick={onSelected}
        disabled={selectedDisabled}
        style={{
          ...styles.filterPill,
          ...(filter.mode === "selected" ? styles.filterPillActive : null),
          ...(selectedDisabled ? styles.filterPillDisabled : null),
        }}
        aria-pressed={filter.mode === "selected"}
        title={
          selectedDisabled
            ? "Pick a component in the left rail to enable per-tool filtering."
            : `Show only invocations of ${selectedTool}`
        }
        data-testid="cpk-studio-timeline-filter-selected"
      >
        selected{selectedTool ? `: ${selectedTool}` : ""}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Internal: virtualized row list
// ---------------------------------------------------------------------------

function VirtualList({
  events,
  onReproduce,
  rowHeight,
}: {
  events: TimelineEvent[];
  onReproduce: (event: TimelineEvent) => void;
  rowHeight: number;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const stickToBottomRef = useRef(true);

  // Track scroll to drive the windowing math.
  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    // If the user has scrolled away from the bottom, stop auto-sticking.
    // Threshold of 8px so subpixel rounding doesn't unstick.
    const distanceFromBottom = el.scrollHeight - (scrollTop + el.clientHeight);
    stickToBottomRef.current = distanceFromBottom < 8;
    setViewport((prev) =>
      prev.scrollTop === scrollTop ? prev : { ...prev, scrollTop },
    );
  }, []);

  // Set initial height and update on resize.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setViewport((prev) => ({ ...prev, height: el.clientHeight }));
    update();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
    };
  }, []);

  // Auto-scroll to bottom when new rows arrive AND the user is already
  // pinned to the bottom. Matches the "tail -f" feel.
  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const totalHeight = events.length * rowHeight;
  // Render 6 rows of overscan above + below so fast-scroll doesn't show
  // blank slots.
  const overscan = 6;
  const start = Math.max(
    0,
    Math.floor(viewport.scrollTop / rowHeight) - overscan,
  );
  const visibleCount =
    Math.ceil((viewport.height || rowHeight * 12) / rowHeight) + overscan * 2;
  const end = Math.min(events.length, start + visibleCount);
  const slice = events.slice(start, end);
  const offsetTop = start * rowHeight;

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={styles.virtualScroll}
      data-testid="cpk-studio-timeline-virtual"
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div
          style={{ position: "absolute", top: offsetTop, left: 0, right: 0 }}
        >
          {slice.map((event) => (
            <Row
              key={event.id}
              event={event}
              onReproduce={onReproduce}
              rowHeight={rowHeight}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  event,
  onReproduce,
  rowHeight,
}: {
  event: TimelineEvent;
  onReproduce: (event: TimelineEvent) => void;
  rowHeight: number;
}): ReactElement {
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onReproduce(event);
    },
    [event, onReproduce],
  );

  return (
    <div
      style={{ ...styles.row, height: rowHeight }}
      data-testid="cpk-studio-timeline-row"
      data-tool={event.tool}
      data-status={event.status}
    >
      <time style={styles.rowTime}>{formatTime(event.at)}</time>
      <span style={styles.rowTool}>{event.tool}</span>
      <span style={styles.rowArgs} title={argsTitle(event.args)}>
        {formatArgs(event.args)}
      </span>
      <StatusDot status={event.status} />
      {event.status === "error" && event.error ? (
        <span style={styles.rowError} title={event.error}>
          {truncate(event.error, 40)}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        style={styles.reproduceBtn}
        title="Send these args into the sandbox"
        data-testid="cpk-studio-timeline-reproduce"
      >
        ↩ Reproduce
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: leaf bits
// ---------------------------------------------------------------------------

function StatusDot({
  status,
}: {
  status: TimelineEvent["status"];
}): ReactElement {
  const color =
    status === "ok"
      ? COLORS.accent
      : status === "error"
        ? COLORS.error
        : COLORS.pending;
  const label =
    status === "ok" ? "succeeded" : status === "error" ? "errored" : "pending";
  return (
    <span
      aria-label={label}
      title={label}
      style={{ ...styles.statusDot, backgroundColor: color }}
    />
  );
}

function ConnectionPip({ connected }: { connected: boolean }): ReactElement {
  return (
    <span
      style={{
        ...styles.pip,
        backgroundColor: connected ? COLORS.accent : COLORS.error,
      }}
      title={connected ? "Runtime connected" : "Runtime not connected"}
      aria-label={connected ? "Runtime connected" : "Runtime not connected"}
    />
  );
}

function EmptyState({
  connected,
  filterMode,
  selectedTool,
}: {
  connected: boolean;
  filterMode: TimelineFilter["mode"];
  selectedTool: string | null;
}): ReactElement {
  if (!connected) {
    return (
      <div style={styles.empty}>
        <strong>No runtime connected.</strong>
        <p style={styles.emptyHint}>
          Start your CopilotKit app and the studio will subscribe to its{" "}
          <code>/cpk-debug-events</code> stream. Until then, invocations can't
          flow.
        </p>
      </div>
    );
  }
  if (filterMode === "selected" && selectedTool) {
    return (
      <div style={styles.empty}>
        <strong>No invocations yet for {selectedTool}.</strong>
        <p style={styles.emptyHint}>
          Trigger a chat interaction that calls <code>{selectedTool}</code>, or
          switch the filter back to <em>all</em>.
        </p>
      </div>
    );
  }
  return (
    <div style={styles.empty}>
      <strong>No invocations yet.</strong>
      <p style={styles.emptyHint}>
        Trigger an interaction in your running app and you'll see entries land
        here in real time.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  } catch {
    return iso;
  }
}

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return "{}";
  if (typeof args !== "object") return String(args);
  try {
    const json = JSON.stringify(args);
    return truncate(json, 80);
  } catch {
    return "[unserializable]";
  }
}

function argsTitle(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ---------------------------------------------------------------------------
// Styles — inline like App.tsx; Tailwind plumbing is M8.
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  shell: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    color: COLORS.text,
    borderTop: `1px solid ${COLORS.borderStrong}`,
    backgroundColor: COLORS.surface,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxSizing: "border-box",
    width: "100%",
  },
  strip: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    height: COLLAPSED_HEIGHT,
    padding: "0 0.75rem",
    cursor: "pointer",
    userSelect: "none",
    flexShrink: 0,
    backgroundColor: COLORS.surfaceMuted,
    borderBottom: `1px solid ${COLORS.border}`,
  },
  chevron: {
    color: COLORS.textMuted,
    width: "0.75rem",
    display: "inline-block",
  },
  stripLabel: {
    fontWeight: 600,
    letterSpacing: 0.5,
  },
  stripDot: {
    color: COLORS.textMuted,
  },
  stripCount: {
    color: COLORS.textMuted,
  },
  stripRecent: {
    color: COLORS.textMuted,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    minWidth: 0,
  },
  stripTime: {
    color: COLORS.text,
  },
  stripTool: {
    color: COLORS.accent,
    fontWeight: 500,
  },
  muted: {
    color: COLORS.textMuted,
    fontStyle: "italic",
  },
  spacer: {
    flex: 1,
  },
  kbd: {
    color: COLORS.textMuted,
    fontSize: 11,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 3,
    padding: "1px 6px",
    backgroundColor: COLORS.surface,
  },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 999,
    display: "inline-block",
  },
  filterGroup: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
  },
  filterLabel: {
    color: COLORS.textMuted,
  },
  filterPill: {
    fontFamily: "inherit",
    fontSize: 11,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 999,
    padding: "2px 8px",
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    cursor: "pointer",
  },
  filterPillActive: {
    backgroundColor: COLORS.accentSubtle,
    borderColor: COLORS.accent,
    color: COLORS.accent,
    fontWeight: 500,
  },
  filterPillDisabled: {
    cursor: "not-allowed",
    opacity: 0.5,
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  virtualScroll: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    backgroundColor: COLORS.surface,
  },
  row: {
    display: "grid",
    gridTemplateColumns:
      "72px minmax(120px, 200px) minmax(0, 1fr) auto auto auto",
    gap: "0.5rem",
    alignItems: "center",
    padding: "0 0.75rem",
    borderBottom: `1px solid ${COLORS.border}`,
    backgroundColor: COLORS.surface,
  },
  rowTime: {
    color: COLORS.textMuted,
  },
  rowTool: {
    color: COLORS.accent,
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowArgs: {
    color: COLORS.text,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  rowError: {
    color: COLORS.error,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    maxWidth: 220,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    display: "inline-block",
    flexShrink: 0,
  },
  reproduceBtn: {
    fontFamily: "inherit",
    fontSize: 11,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    padding: "2px 8px",
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  empty: {
    padding: "1.25rem 1rem",
    color: COLORS.textMuted,
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  emptyHint: {
    marginTop: "0.5rem",
    fontSize: 12,
    color: COLORS.textMuted,
  },
};
