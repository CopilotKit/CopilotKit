"use client";

import React, { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { AbstractAgent } from "@ag-ui/client";
import { useCopilotKit } from "../providers/CopilotKitProvider";

// The app<->host protocol (ext-apps AppBridge, sandbox proxy, request queue,
// ui/message + open-link handlers, tool input/result) lives in the shared,
// framework-agnostic package. This file is now a THIN React adapter over it: it
// owns the iframe (create/mount/size/remove) and wires the session's reactive
// hooks to React state; all protocol logic is `bindMcpApp`.
//
// The lightweight activity surface (type + content schema + follow-up runner)
// is re-exported from the package's bridge-free `/activity` entry, so importing
// it (for the activity registry) does NOT pull the ext-apps bundle. The bridge
// itself is loaded lazily via a dynamic `import("@copilotkit/mcp-apps-renderer")`
// inside the effect, so a `<CopilotKitProvider>` app only pays for it when it actually
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

import type { MCPAppsActivityContent } from "@copilotkit/mcp-apps-renderer/activity";
import { ɵMcpAppHost } from "@copilotkit/mcp-apps-renderer/activity";

/**
 * Props for the activity renderer component
 */
interface MCPAppsActivityRendererProps {
  activityType: string;
  content: MCPAppsActivityContent;
  message: unknown; // ActivityMessage from @ag-ui/core
  agent: AbstractAgent | undefined;
  /**
   * Restore `allow-same-origin` on the sandbox. Unsafe: the widget runs with
   * the host page's origin. Set via `mcpApps.allowSameOriginFallback` on
   * `CopilotKitProvider`.
   */
  allowSameOriginFallback?: boolean;
}

/**
 * MCP Apps Extension Activity Renderer
 *
 * Renders MCP Apps UI in a sandboxed iframe with full protocol support. The
 * shared `ɵMcpAppHost` owns the iframe, its size and its state, and binds the
 * protocol session (`bindMcpApp`, loaded lazily); this component only draws
 * the state around it.
 */
export const MCPAppsActivityRenderer: React.FC<MCPAppsActivityRendererProps> =
  function MCPAppsActivityRenderer({
    content,
    message,
    agent,
    allowSameOriginFallback,
  }) {
    const { copilotkit } = useCopilotKit();
    const containerRef = useRef<HTMLDivElement>(null);
    // The activity message id: the session follows it in the agent's store.
    const messageId = (message as { id?: string } | undefined)?.id;

    // A new host or sandbox setting needs a new host object.
    const app = useMemo(
      () =>
        new ɵMcpAppHost({
          host: copilotkit,
          sessionOptions: { allowSameOriginFallback },
          importRenderer: () => import("@copilotkit/mcp-apps-renderer"),
        }),
      [copilotkit, allowSameOriginFallback],
    );

    const state = useSyncExternalStore(
      app.subscribe,
      app.getState,
      app.getState,
    );

    useEffect(() => {
      app.setAgent(agent);
      app.setMessageId(messageId);
    }, [app, agent, messageId]);
    useEffect(() => {
      app.setContent(content);
    }, [app, content]);
    useEffect(() => {
      app.setContainer(containerRef.current);
      return () => app.destroy();
    }, [app]);

    // prefersBorder: true = border and background; otherwise none.
    const borderStyle = state.prefersBorder
      ? {
          borderRadius: "8px",
          backgroundColor: "#f9f9f9",
          border: "1px solid #e0e0e0",
        }
      : {};
    const shownError = state.error ?? state.contentError;

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: state.size.height ? `${state.size.height}px` : "auto",
          minHeight: "100px",
          overflow: "hidden",
          position: "relative",
          ...borderStyle,
        }}
      >
        {state.loading && (
          <div style={{ padding: "1rem", color: "#666" }}>Loading...</div>
        )}
        {shownError && (
          <div style={{ color: "red", padding: "1rem" }}>
            Error: {shownError}
          </div>
        )}
      </div>
    );
  };
