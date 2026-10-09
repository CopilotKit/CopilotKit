"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AbstractAgent } from "@ag-ui/client";
import { useCopilotKit } from "../providers/CopilotKitProvider";

// The app<->host protocol (ext-apps AppBridge, sandbox proxy, request queue,
// ui/message + open-link handlers, tool input/result, request-display-mode)
// lives in the shared, framework-agnostic package. This file is now a THIN
// React adapter over it: it owns the iframe (create/mount/size/remove) and the
// display surface (a native <dialog> for inline/fullscreen), and wires the
// session's reactive hooks to React state; all protocol logic is `bindMcpApp`.
//
// The lightweight activity surface (type + content schema + follow-up runner)
// is re-exported from the package's bridge-free `/activity` entry, so importing
// it (for the activity registry) does NOT pull the ext-apps bundle. The bridge
// itself is loaded lazily via a dynamic `import("@copilotkit/mcp-apps-renderer")`
// inside the effect, so a `<CopilotKit>` app only pays for it when it actually
// renders an MCP App.
export {
  MCPAppsActivityType,
  MCPAppsActivityContentSchema,
  ɵrunMcpFollowUp,
} from "@copilotkit/mcp-apps-renderer/activity";
export type {
  MCPAppsActivityContent,
  ɵMcpFollowUpHost,
} from "@copilotkit/mcp-apps-renderer/activity";

import {
  ɵlockBodyScroll,
  ɵshowDialogForMode,
} from "@copilotkit/mcp-apps-renderer/activity";
import type {
  MCPAppsActivityContent,
  McpAppsDisplayMode,
} from "@copilotkit/mcp-apps-renderer/activity";
// Type-only imports: erased at build, so they never pull the ext-apps bridge
// into the bundle. Only the dynamic import() below does, and only lazily.
import type {
  McpAppSession,
  FetchedResource,
} from "@copilotkit/mcp-apps-renderer";

/**
 * Props for the activity renderer component
 */
interface MCPAppsActivityRendererProps {
  activityType: string;
  content: MCPAppsActivityContent;
  message: unknown; // ActivityMessage from @ag-ui/core
  agent: AbstractAgent | undefined;
}

/**
 * MCP Apps Extension Activity Renderer
 *
 * Renders MCP Apps UI in a sandboxed iframe with full protocol support.
 * Fetches resource content on-demand via proxied MCP requests. The React shell
 * owns the iframe and the display surface; `bindMcpApp` owns the protocol.
 */
export const MCPAppsActivityRenderer: React.FC<MCPAppsActivityRendererProps> =
  function MCPAppsActivityRenderer({ content, message, agent }) {
    const { copilotkit } = useCopilotKit();
    // The activity message id. Passed to the session so it self-subscribes to the
    // agent's activity stream and pushes tool input/result itself (the adapter no
    // longer forwards them).
    const messageId = (message as { id?: string } | undefined)?.id;
    const containerRef = useRef<HTMLDialogElement>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const sessionRef = useRef<McpAppSession | null>(null);
    const [error, setError] = useState<Error | null>(null);
    // Recoverable: an activity update the content schema rejected, from the
    // store or from props. Cleared as soon as valid content resumes, unlike
    // `error`, which is a fatal setup failure.
    const [contentError, setContentError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [iframeSize, setIframeSize] = useState<{
      width?: number;
      height?: number;
    }>({});
    const [fetchedResource, setFetchedResource] =
      useState<FetchedResource | null>(null);
    // The display mode the session granted. The session owns the negotiation
    // (grant/refuse + host-context notification); this adapter only renders
    // the surface for the mode, fed by the onDisplayModeChange hook below.
    const [displayMode, setDisplayMode] =
      useState<McpAppsDisplayMode>("inline");

    // Latest content/agent for the session's live getters (they must read the
    // current values on every proxied request, not the values at bind time).
    const contentRef = useRef(content);
    contentRef.current = content;
    const agentRef = useRef(agent);
    agentRef.current = agent;

    // Host-initiated exit from fullscreen (close button or Escape). Routed
    // through the session so the host context is updated and the widget is
    // notified, exactly like a widget-initiated change.
    const exitFullscreen = useCallback(() => {
      sessionRef.current?.setDisplayMode("inline");
    }, []);

    // Effect 1: create the sandbox iframe and bind the MCP session. Re-binds
    // only when the widget identity (resourceUri/serverHash/serverId) or the
    // agent/host changes - NOT when tool input/result stream in (those are
    // pushed by the effects below without recreating the iframe).
    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      if (!agent) {
        setError(new Error("No agent available to fetch resource"));
        setIsLoading(false);
        return;
      }

      let mounted = true;
      setIsLoading(true);
      setError(null);
      setContentError(null);
      setDisplayMode("inline");

      // The host owns the iframe: create + mount it here (bindMcpApp only
      // configures the sandbox contract + talks to it through the bridge).
      const iframe = document.createElement("iframe");
      iframe.style.width = "100%";
      iframe.style.height = "100px";
      iframe.style.border = "none";
      iframe.style.backgroundColor = "transparent";
      iframe.style.display = "block";
      container.appendChild(iframe);
      iframeRef.current = iframe;

      const setup = async () => {
        try {
          // Load the bridge package lazily. The bridge is heavy (it pulls the
          // MCP SDK Protocol + zod schemas, ~40-50 kB gzipped); keeping it behind
          // a dynamic import() means a non-MCP `<CopilotKit>` app never pays for
          // it. The `.catch` below rethrows with an actionable message if the
          // package (or its ext-apps dependency) is missing - a raw module
          // resolution error would not say what to install.
          const mod = await import("@copilotkit/mcp-apps-renderer").catch(
            (importErr) => {
              throw new Error(
                "MCP Apps require '@copilotkit/mcp-apps-renderer' and its " +
                  "'@modelcontextprotocol/ext-apps' dependency. Reinstall your " +
                  "dependencies if this package is missing.",
                { cause: importErr },
              );
            },
          );
          if (!mounted) {
            iframe.remove();
            return;
          }

          const session = mod.bindMcpApp({
            iframe,
            getContent: () => contentRef.current,
            getAgent: () => agentRef.current,
            host: copilotkit,
            // Self-driving: the session subscribes to the agent's activity
            // stream (filtered by messageId) and pushes tool input/result to the
            // widget itself, so this adapter does not forward STORE-backed
            // activities. It still calls syncContent for activities rendered
            // from an external messages list (see the seed below).
            messageId,
            hooks: {
              onResource: (resource) => {
                if (!mounted) return;
                setFetchedResource(resource);
                setIsLoading(false);
              },
              onSizeChanged: (size) => {
                if (mounted) setIframeSize(size);
              },
              onDisplayModeChange: (mode) => {
                if (mounted) setDisplayMode(mode);
              },
              onContentError: (err) => {
                if (mounted) setContentError(err);
              },
              onError: (err) => {
                if (!mounted) return;
                setError(err);
                setIsLoading(false);
              },
            },
          });
          sessionRef.current = session;
          // Seed the initial content now: the forwarding effect below first runs
          // at mount, before this async import resolved sessionRef, so it no-ops
          // and never re-runs for unchanged props. Without this seed, an activity
          // rendered from an external messages list (absent from agent.messages)
          // would never receive its initial tool input/result. Deduped + store
          // precedence make this a no-op for agent-backed activities.
          session.syncContent(contentRef.current);
        } catch (err) {
          console.error("[MCPAppsRenderer] Setup error:", err);
          if (mounted) {
            setError(err instanceof Error ? err : new Error(String(err)));
            setIsLoading(false);
          }
        }
      };

      void setup();

      return () => {
        mounted = false;
        sessionRef.current?.teardown();
        sessionRef.current = null;
        iframe.remove();
        iframeRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      agent,
      copilotkit,
      messageId,
      content.resourceUri,
      content.serverHash,
      content.serverId,
    ]);

    // Open the <dialog> surface for the granted mode: inline in normal flow,
    // fullscreen in the browser top layer. The iframe lives inside the dialog
    // and is never reparented, so toggling modes keeps the widget's state.
    useEffect(() => {
      const dialog = containerRef.current;
      if (dialog) ɵshowDialogForMode(dialog, displayMode);
    }, [displayMode]);

    // While fullscreen: lock the page scroll behind the widget (shared with
    // the other widgets on the page) and refresh the advertised surface when
    // the viewport resizes. Focus containment, focus restore and Escape come
    // from the modal <dialog> itself.
    useEffect(() => {
      if (displayMode !== "fullscreen") return;
      const onResize = () => sessionRef.current?.setDisplayMode("fullscreen");
      window.addEventListener("resize", onResize);
      const releaseScrollLock = ɵlockBodyScroll();
      return () => {
        window.removeEventListener("resize", onResize);
        releaseScrollLock();
      };
    }, [displayMode]);

    // Effect 2: size the iframe. In fullscreen it fills the surface; inline it
    // follows the size the widget reports, back to the initial height when the
    // widget never reported one (so leaving fullscreen never keeps the 100%).
    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      if (displayMode === "fullscreen") {
        iframe.style.minWidth = "100%";
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        return;
      }
      if (iframeSize.width !== undefined) {
        // Use minWidth with min() to allow expansion but cap at 100%
        iframe.style.minWidth = `min(${iframeSize.width}px, 100%)`;
        iframe.style.width = "100%";
      }
      iframe.style.height =
        iframeSize.height !== undefined ? `${iframeSize.height}px` : "100px";
    }, [iframeSize, displayMode]);

    // Forward tool input/result from the content prop. The session is
    // self-driving for activities that live in the agent's message store, but a
    // host can render an activity from an EXTERNAL messages list (CopilotChatView's
    // `messages` prop) that is absent from `agent.messages`; this keeps such
    // widgets fed. `syncContent` is deduped and shares the subscription's dedup,
    // so the agent-driven path never double-sends.
    useEffect(() => {
      sessionRef.current?.syncContent(contentRef.current);
    }, [content.toolInput, content.result]);

    // Determine border styling based on prefersBorder metadata from fetched resource
    // true = show border/background, false = none, undefined = host decides (we default to none)
    const prefersBorder = fetchedResource?._meta?.ui?.prefersBorder;
    const borderStyle =
      prefersBorder === true
        ? {
            borderRadius: "8px",
            backgroundColor: "#f9f9f9",
            border: "1px solid #e0e0e0",
          }
        : {};

    const isFullscreen = displayMode === "fullscreen";

    // The widget surface is a native <dialog>: inline neutralizes the UA dialog
    // styles so it renders as an in-flow block, fullscreen fills the viewport
    // from the top layer. Escape on the modal dialog fires `cancel`, mapped to
    // the host-initiated exit so the widget is notified like for the button.
    return (
      <dialog
        ref={containerRef}
        aria-label={isFullscreen ? "Fullscreen widget" : undefined}
        onCancel={(e) => {
          e.preventDefault();
          exitFullscreen();
        }}
        style={
          isFullscreen
            ? {
                position: "fixed",
                inset: 0,
                margin: 0,
                padding: 0,
                border: "none",
                maxWidth: "none",
                maxHeight: "none",
                width: "100vw",
                height: "100vh",
                overflow: "auto",
                zIndex: 2147483000,
                // The chat's own background token, so the overlay does not
                // flash white in dark mode.
                background: "var(--background, #fff)",
                color: "inherit",
              }
            : {
                position: "static",
                margin: 0,
                padding: 0,
                border: "none",
                maxWidth: "none",
                maxHeight: "none",
                width: "100%",
                height: iframeSize.height ? `${iframeSize.height}px` : "auto",
                minHeight: "100px",
                overflow: "hidden",
                background: "transparent",
                color: "inherit",
                ...borderStyle,
              }
        }
      >
        {isFullscreen && (
          <button
            type="button"
            aria-label="Exit fullscreen"
            onClick={exitFullscreen}
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              zIndex: 1,
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              border: "none",
              borderRadius: "50%",
              background: "rgba(0, 0, 0, 0.6)",
              color: "#fff",
              fontSize: "18px",
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        )}
        {isLoading && (
          <div style={{ padding: "1rem", color: "#666" }}>Loading...</div>
        )}
        {(error ?? contentError) && (
          <div style={{ color: "red", padding: "1rem" }}>
            Error: {(error ?? contentError)!.message}
          </div>
        )}
      </dialog>
    );
  };
