import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

import type { ToolDescriptor } from "../../shared/types.js";

/**
 * CopilotKit Studio — sandbox iframe component.
 *
 * Wraps an iframe pointed at the user's running CopilotKit app with the
 * `?__cpk_sandbox=<tool_name>&args=<base64-json>` sentinel query-param. The
 * iframe boots `CopilotKitProvider` in sandbox mode (see
 * `@copilotkit/react-core/src/v2/components/InspectorSandboxHost.tsx`),
 * which short-circuits the chat surface and renders only the named tool's
 * `render(args)` inside the user's existing provider chain.
 *
 * Wire protocol (mirrored from `packages/react-core/src/v2/lib/sandbox-params.ts`,
 * canonical source):
 *
 *   parent → iframe:  ParentToSandboxMessage
 *     | { kind: "host-context"; theme: "dark" | "light" }
 *     | { kind: "args"; args: unknown }
 *
 *   iframe → parent:  SandboxToParentMessage
 *     | { kind: "ready"; needsArgs: boolean }
 *     | { kind: "render-error"; message: string; stack?: string }
 *     | { kind: "request-args" }
 *
 * Spec: .chalk/plans/web-inspector-v1.md §6.5
 */

// ---------------------------------------------------------------------------
// Wire protocol — mirrors `react-core`'s sandbox-params.ts. The studio cannot
// `import type` from react-core without re-introducing the V1/V2 cycle, so
// these types are duplicated here. **Keep in sync** — see the spec.
// ---------------------------------------------------------------------------

type ParentToSandboxMessage =
  | { kind: "host-context"; theme: "dark" | "light" }
  | { kind: "args"; args: unknown };

type SandboxToParentMessage =
  | { kind: "ready"; needsArgs: boolean }
  | { kind: "render-error"; message: string; stack?: string }
  | { kind: "request-args" };

function isSandboxToParentMessage(
  value: unknown,
): value is SandboxToParentMessage {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "ready" || kind === "render-error" || kind === "request-args";
}

// ---------------------------------------------------------------------------
// URL encoding. Mirrors react-core's encoder. ≤ 2KB blobs go in the URL;
// larger blobs are omitted and re-sent over postMessage after `ready`.
// ---------------------------------------------------------------------------

const SANDBOX_QUERY_PARAM = "__cpk_sandbox";
const SANDBOX_ARGS_QUERY_PARAM = "args";
const SANDBOX_ARGS_URL_LIMIT_BYTES = 2048;

function encodeSandboxArgs(args: unknown): string | null {
  let json: string;
  try {
    json = JSON.stringify(args ?? {});
  } catch {
    return null;
  }
  // Browser-only — runs in the studio SPA.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const latin1 = unescape(encodeURIComponent(json));
  const encoded = btoa(latin1)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (encoded.length > SANDBOX_ARGS_URL_LIMIT_BYTES) {
    return null;
  }
  return encoded;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SandboxFrameProps {
  /**
   * Origin of the user's running CopilotKit app (e.g. `http://localhost:3000`).
   * The iframe `src` is built as `${runtimeUrl}/?__cpk_sandbox=<tool>&args=<...>`.
   */
  runtimeUrl: string;

  /**
   * The tool to render in the sandbox. Only `tool.name` and `tool.filePath`
   * are read by this component; the full descriptor is accepted so future
   * work can surface metadata (description, source link) in the chrome
   * around the iframe.
   */
  tool: ToolDescriptor;

  /** Mock args passed into `tool.render(args)`. */
  args: unknown;

  /** Theme to forward to the iframe in the `host-context` handshake. */
  theme?: "dark" | "light";

  /**
   * Called when the iframe reports a render-time crash. The studio renders
   * an overlay in the iframe area as the user-visible surface for this; the
   * callback is here so the parent can log / report / clear state.
   */
  onError?: (err: { message: string; stack?: string }) => void;

  /** Called when the iframe sends the `ready` handshake. Optional. */
  onReady?: () => void;

  /** Inline CSS style merged onto the iframe wrapper. */
  style?: CSSProperties;
}

const IFRAME_SANDBOX_ATTR = "allow-scripts allow-same-origin";

/**
 * Build the iframe `src`. When the args blob fits in the URL we include it;
 * otherwise we omit it and rely on the postMessage handshake.
 */
function buildIframeSrc(
  runtimeUrl: string,
  toolName: string,
  args: unknown,
): { src: string; argsInUrl: boolean } {
  const base = runtimeUrl.replace(/\/+$/, "");
  const encodedArgs = encodeSandboxArgs(args);
  const url = new URL(`${base}/`);
  url.searchParams.set(SANDBOX_QUERY_PARAM, toolName);
  if (encodedArgs !== null) {
    url.searchParams.set(SANDBOX_ARGS_QUERY_PARAM, encodedArgs);
  }
  return { src: url.toString(), argsInUrl: encodedArgs !== null };
}

export function SandboxFrame({
  runtimeUrl,
  tool,
  args,
  theme = "light",
  onError,
  onReady,
  style,
}: SandboxFrameProps): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [overlay, setOverlay] = useState<{
    message: string;
    stack?: string;
  } | null>(null);
  const [iframeReady, setIframeReady] = useState(false);

  // Rebuild the iframe src whenever the tool name, runtime, or args change.
  // We deliberately reload the iframe (key change) when the tool changes so
  // the user gets a clean mount, but keep the same iframe across args
  // changes — args are pushed via postMessage instead to avoid full reloads.
  const { src, argsInUrl } = useMemo(
    () => buildIframeSrc(runtimeUrl, tool.name, args),
    [runtimeUrl, tool.name, args],
  );
  const iframeKey = `${runtimeUrl}::${tool.name}`;

  // Reset overlay when the tool changes (a new mount).
  useEffect(() => {
    setOverlay(null);
    setIframeReady(false);
  }, [iframeKey]);

  // Listen for `SandboxToParentMessage` events from the iframe.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Only accept messages from our iframe. `event.source` is the iframe's
      // window when the message originates from there.
      if (!iframeRef.current) return;
      if (event.source !== iframeRef.current.contentWindow) return;
      const data: unknown = event.data;
      if (!isSandboxToParentMessage(data)) return;

      switch (data.kind) {
        case "ready":
          setIframeReady(true);
          onReady?.();
          // Send the host-context now that the iframe is alive.
          postToIframe(iframeRef.current, { kind: "host-context", theme });
          // If the URL was too big to carry args, ship them over postMessage.
          if (data.needsArgs && !argsInUrl) {
            postToIframe(iframeRef.current, { kind: "args", args });
          }
          break;
        case "render-error":
          setOverlay({ message: data.message, stack: data.stack });
          onError?.({ message: data.message, stack: data.stack });
          break;
        case "request-args":
          postToIframe(iframeRef.current, { kind: "args", args });
          break;
      }
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
    };
    // We intentionally include `args` and `theme` so the closure captures the
    // latest values when a `request-args` arrives.
  }, [argsInUrl, args, theme, onError, onReady]);

  // After `ready`, push args / theme updates over postMessage. This is the
  // hot path for the form editor — the iframe never reloads, only re-renders.
  useEffect(() => {
    if (!iframeReady) return;
    if (!iframeRef.current) return;
    postToIframe(iframeRef.current, { kind: "args", args });
  }, [iframeReady, args]);

  useEffect(() => {
    if (!iframeReady) return;
    if (!iframeRef.current) return;
    postToIframe(iframeRef.current, { kind: "host-context", theme });
  }, [iframeReady, theme]);

  const dismissOverlay = () => setOverlay(null);

  return (
    <div style={{ ...wrapperStyles.shell, ...style }}>
      <iframe
        key={iframeKey}
        ref={iframeRef}
        src={src}
        sandbox={IFRAME_SANDBOX_ATTR}
        title={`CopilotKit Studio sandbox — ${tool.name}`}
        style={wrapperStyles.iframe}
      />
      {overlay ? (
        <div style={wrapperStyles.overlay} role="alert">
          <div style={wrapperStyles.overlayCard}>
            <strong style={wrapperStyles.overlayTitle}>Render error</strong>
            <p style={wrapperStyles.overlayMessage}>{overlay.message}</p>
            {overlay.stack ? (
              <details style={wrapperStyles.overlayDetails}>
                <summary>Stack</summary>
                <pre style={wrapperStyles.overlayStack}>{overlay.stack}</pre>
              </details>
            ) : null}
            <button
              type="button"
              onClick={dismissOverlay}
              style={wrapperStyles.overlayDismiss}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function postToIframe(
  iframe: HTMLIFrameElement,
  message: ParentToSandboxMessage,
): void {
  try {
    iframe.contentWindow?.postMessage(message, "*");
  } catch {
    // Cross-origin during teardown — ignore.
  }
}

// ---------------------------------------------------------------------------
// Styles — intentionally inline. The polished Components/Args/Timeline shell
// lands in M2-M5; this component is the iframe-only surface, kept minimal so
// later polish can replace it without touching protocol code.
// ---------------------------------------------------------------------------

const wrapperStyles: Record<string, CSSProperties> = {
  shell: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 320,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
  },
  iframe: {
    width: "100%",
    height: "100%",
    border: "none",
    display: "block",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(255, 255, 255, 0.92)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  overlayCard: {
    maxWidth: 520,
    width: "100%",
    background: "#fff",
    border: "1px solid #d4d4d8",
    borderRadius: 8,
    padding: "1rem 1.25rem",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  overlayTitle: {
    display: "block",
    color: "#b91c1c",
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 4,
  },
  overlayMessage: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "#111",
    margin: "0 0 0.75rem",
  },
  overlayDetails: {
    fontSize: 12,
    color: "#52525b",
    marginBottom: "0.75rem",
  },
  overlayStack: {
    maxHeight: 200,
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    background: "#fafafa",
    padding: "0.5rem",
    borderRadius: 4,
    margin: 0,
  },
  overlayDismiss: {
    fontSize: 12,
    padding: "0.375rem 0.75rem",
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
};
