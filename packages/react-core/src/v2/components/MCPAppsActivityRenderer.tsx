"use client";

import React, { useEffect, useRef, useState } from "react";
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

import type { MCPAppsActivityContent } from "@copilotkit/mcp-apps-renderer/activity";
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
 * owns the iframe; `bindMcpApp` owns the protocol.
 */
export const MCPAppsActivityRenderer: React.FC<MCPAppsActivityRendererProps> =
  function MCPAppsActivityRenderer({ content, agent }) {
    const { copilotkit } = useCopilotKit();
    const containerRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const sessionRef = useRef<McpAppSession | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [iframeSize, setIframeSize] = useState<{
      width?: number;
      height?: number;
    }>({});
    const [fetchedResource, setFetchedResource] =
      useState<FetchedResource | null>(null);

    // Latest content/agent for the session's live getters (they must read the
    // current values on every proxied request, not the values at bind time).
    const contentRef = useRef(content);
    contentRef.current = content;
    const agentRef = useRef(agent);
    agentRef.current = agent;

    // Effect 1: create the sandbox iframe and bind the MCP session. Re-binds
    // only when the widget identity (resourceUri/serverHash) or the agent/host
    // changes - NOT when tool input/result stream in (those are pushed by the
    // effects below without recreating the iframe).
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
          // it. The try/catch rethrows with an actionable message if the package
          // (or its ext-apps dependency) is missing.
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
            hooks: {
              onResource: (resource) => {
                if (!mounted) return;
                setFetchedResource(resource);
                setIsLoading(false);
              },
              onSizeChanged: (size) => {
                if (mounted) setIframeSize(size);
              },
              onError: (err) => {
                if (!mounted) return;
                setError(err);
                setIsLoading(false);
              },
            },
          });
          sessionRef.current = session;

          // Push any tool input/result already present at bind time (the session
          // buffers until the widget reports initialized).
          const current = contentRef.current;
          if (current.toolInput) {
            session.sendToolInput(current.toolInput as Record<string, unknown>);
          }
          if (current.result) {
            session.sendToolResult(
              current.result as Parameters<McpAppSession["sendToolResult"]>[0],
            );
          }
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
    }, [agent, copilotkit, content.resourceUri, content.serverHash]);

    // Effect 2: size the iframe when the widget reports a new content size.
    useEffect(() => {
      if (iframeRef.current) {
        if (iframeSize.width !== undefined) {
          // Use minWidth with min() to allow expansion but cap at 100%
          iframeRef.current.style.minWidth = `min(${iframeSize.width}px, 100%)`;
          iframeRef.current.style.width = "100%";
        }
        if (iframeSize.height !== undefined) {
          iframeRef.current.style.height = `${iframeSize.height}px`;
        }
      }
    }, [iframeSize]);

    // Effect 3: forward tool input to the widget (buffered by the session until
    // the widget is ready).
    useEffect(() => {
      if (content.toolInput) {
        sessionRef.current?.sendToolInput(
          content.toolInput as Record<string, unknown>,
        );
      }
    }, [content.toolInput]);

    // Effect 4: forward tool result to the widget.
    useEffect(() => {
      if (content.result) {
        sessionRef.current?.sendToolResult(
          content.result as Parameters<McpAppSession["sendToolResult"]>[0],
        );
      }
    }, [content.result]);

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

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: iframeSize.height ? `${iframeSize.height}px` : "auto",
          minHeight: "100px",
          overflow: "hidden",
          position: "relative",
          ...borderStyle,
        }}
      >
        {isLoading && (
          <div style={{ padding: "1rem", color: "#666" }}>Loading...</div>
        )}
        {error && (
          <div style={{ color: "red", padding: "1rem" }}>
            Error: {error.message}
          </div>
        )}
      </div>
    );
  };
