import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

import type { LauncherEvent, ToolDescriptor } from "../shared/types.js";

const keyOf = (t: ToolDescriptor): string =>
  `${t.filePath}::${t.name}::${t.loc.line}`;

/**
 * M0 SPA — a dumb list of detected tool names + file paths.
 *
 * Connects to the launcher's WebSocket and renders whatever the launcher
 * broadcasts. Styling is intentionally minimal here; the polished
 * Components/Sandbox/Args/Timeline layout lands in M2-M5.
 */

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

const STUDIO_TITLE = "CopilotKit Studio";

function buildWsUrl(): string {
  // The SPA is served by the launcher's HTTP server, so window.location
  // already points at the launcher's host+port. M0 stays on `ws:` —
  // localhost-only, no TLS.
  const { hostname, port } = window.location;
  return `ws://${hostname}:${port}/__inspector/ws`;
}

export function App(): ReactElement {
  const wsUrl = useMemo(() => buildWsUrl(), []);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [rootDir, setRootDir] = useState<string | null>(null);
  const [scannedFiles, setScannedFiles] = useState<number | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => setConnection("connected"));
    ws.addEventListener("close", () => setConnection("disconnected"));
    ws.addEventListener("error", () => setConnection("error"));
    ws.addEventListener("message", (ev) => {
      let parsed: LauncherEvent;
      try {
        parsed = JSON.parse(ev.data as string) as LauncherEvent;
      } catch {
        return;
      }

      switch (parsed.type) {
        case "workspace.ready":
          setRootDir(parsed.rootDir);
          setScannedFiles(parsed.scannedFiles);
          break;
        case "registry.snapshot":
          setTools(parsed.tools);
          break;
        case "registry.delta":
          // M0 launcher never sends deltas (no file watcher yet) — when M1
          // wires chokidar this becomes the live-update path.
          setTools((previous) => applyDelta(previous, parsed));
          break;
        // fixture.changed, scan.error: ignored in M0 — surface them in the
        // SPA once M2 lands.
        default:
          break;
      }
    });

    return () => {
      ws.close();
    };
  }, [wsUrl]);

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.title}>{STUDIO_TITLE}</h1>
        <ConnectionBadge state={connection} />
      </header>

      <section style={styles.metaRow}>
        {rootDir ? (
          <span style={styles.meta}>
            <strong>Root:</strong> <code>{rootDir}</code>
          </span>
        ) : (
          <span style={styles.meta}>Waiting for workspace.ready...</span>
        )}
        {scannedFiles !== null ? (
          <span style={styles.meta}>
            <strong>Files scanned:</strong> {scannedFiles}
          </span>
        ) : null}
        <span style={styles.meta}>
          <strong>Tools detected:</strong> {tools.length}
        </span>
      </section>

      <main>
        {tools.length === 0 ? (
          <EmptyState connection={connection} />
        ) : (
          <ul style={styles.list}>
            {tools.map((tool, index) => (
              <li
                key={`${tool.filePath}:${tool.loc.line}:${index}`}
                style={styles.row}
              >
                <span style={styles.name}>{tool.name}</span>
                <span style={styles.hook}>{tool.hook}</span>
                <span style={styles.path}>{tool.filePath}</span>
                <span style={styles.lineNumber}>:{tool.loc.line}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }): ReactElement {
  const label =
    state === "connected"
      ? "connected"
      : state === "connecting"
        ? "connecting..."
        : state === "disconnected"
          ? "disconnected"
          : "error";
  const color =
    state === "connected"
      ? "#0a8a4a"
      : state === "connecting"
        ? "#a06a00"
        : "#b22222";
  return (
    <span
      style={{
        ...styles.badge,
        color,
        borderColor: color,
      }}
    >
      {label}
    </span>
  );
}

function EmptyState({
  connection,
}: {
  connection: ConnectionState;
}): ReactElement {
  if (connection !== "connected") {
    return (
      <p style={styles.empty}>
        {connection === "error"
          ? "Could not reach the launcher. Is the studio process still running?"
          : "Connecting to launcher..."}
      </p>
    );
  }
  return (
    <p style={styles.empty}>
      No <code>useCopilotAction</code> call sites found in the configured root.
    </p>
  );
}

/**
 * Apply a `registry.delta` to the current tool list. Deltas don't fire in
 * M0 (no file watcher) but the handler is wired so M1's watcher just works
 * once the launcher starts broadcasting them.
 */
function applyDelta(
  previous: ToolDescriptor[],
  delta: Extract<LauncherEvent, { type: "registry.delta" }>,
): ToolDescriptor[] {
  const removed = new Set(delta.removed);
  const modifiedKeys = new Set(delta.modified.map(keyOf));
  const kept = previous.filter(
    (t) => !removed.has(t.name) && !modifiedKeys.has(keyOf(t)),
  );
  return [...kept, ...delta.modified, ...delta.added];
}

// Inline styles — Tailwind v4 plumbing is intentionally deferred to M2/M8
// per the execution plan. Keep this section tiny and obvious so polish PRs
// can replace it wholesale.
const styles: Record<string, CSSProperties> = {
  shell: {
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    color: "#111",
    padding: "1.5rem 2rem",
    maxWidth: 1200,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1rem",
  },
  title: {
    fontSize: "1.25rem",
    fontWeight: 600,
    margin: 0,
  },
  badge: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    padding: "0.125rem 0.5rem",
    border: "1px solid",
    borderRadius: 999,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaRow: {
    display: "flex",
    gap: "1.5rem",
    flexWrap: "wrap",
    color: "#555",
    fontSize: 13,
    marginBottom: "1rem",
  },
  meta: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    borderTop: "1px solid #eee",
  },
  row: {
    display: "grid",
    gridTemplateColumns:
      "minmax(160px, 1fr) minmax(140px, auto) minmax(0, 3fr) auto",
    gap: "0.75rem",
    padding: "0.5rem 0",
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    borderBottom: "1px solid #eee",
    alignItems: "baseline",
  },
  name: {
    color: "#0a6f3f",
    fontWeight: 600,
  },
  hook: {
    color: "#7755aa",
  },
  path: {
    color: "#555",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  lineNumber: {
    color: "#888",
  },
  empty: {
    color: "#888",
    fontStyle: "italic",
    margin: "1rem 0",
  },
};
