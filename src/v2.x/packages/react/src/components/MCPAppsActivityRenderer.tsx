"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { z } from "zod";
import type { AbstractAgent } from "@ag-ui/client";

// Protocol version supported
const PROTOCOL_VERSION = "2025-06-18";

/**
 * Activity type for MCP Apps events - must match the middleware's MCPAppsActivityType
 */
export const MCPAppsActivityType = "mcp-apps";

// Zod schema for activity content validation
export const MCPAppsActivityContentSchema = z.object({
  result: z.object({
    content: z.array(z.any()).optional(),
    structuredContent: z.any().optional(),
    isError: z.boolean().optional(),
  }),
  resource: z.object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
    // Resource metadata per SEP-1865
    _meta: z.object({
      ui: z.object({
        // Visual boundary preference: true = show border/background, false = none, omitted = host decides
        prefersBorder: z.boolean().optional(),
        // CSP configuration (for future use)
        csp: z.object({
          connectDomains: z.array(z.string()).optional(),
          resourceDomains: z.array(z.string()).optional(),
        }).optional(),
      }).optional(),
    }).optional(),
  }),
  // Server ID for proxying requests (MD5 hash of server config)
  serverId: z.string().optional(),
  // Original tool input arguments
  toolInput: z.record(z.unknown()).optional(),
});

export type MCPAppsActivityContent = z.infer<typeof MCPAppsActivityContentSchema>;

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

function isRequest(msg: JSONRPCMessage): msg is JSONRPCRequest {
  return "id" in msg && "method" in msg;
}

function isNotification(msg: JSONRPCMessage): msg is JSONRPCNotification {
  return !("id" in msg) && "method" in msg;
}

/**
 * Extract HTML content from a resource object
 */
function extractHtmlFromResource(resource: MCPAppsActivityContent["resource"]): string {
  if (resource.text) {
    return resource.text;
  }
  if (resource.blob) {
    // Base64 decode
    return atob(resource.blob);
  }
  throw new Error("Resource has no text or blob content");
}

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
 */
export const MCPAppsActivityRenderer: React.FC<MCPAppsActivityRendererProps> = ({ content, agent }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [iframeSize, setIframeSize] = useState<{ width?: number; height?: number }>({});

  // Use refs for values that shouldn't trigger re-renders but need latest values
  const contentRef = useRef(content);
  contentRef.current = content;

  // Store agent in a ref for use in async handlers
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // Callback to send a message to the iframe
  const sendToIframe = useCallback((msg: JSONRPCMessage) => {
    if (iframeRef.current?.contentWindow) {
      console.log("[MCPAppsRenderer] Sending to iframe:", msg);
      iframeRef.current.contentWindow.postMessage(msg, "*");
    }
  }, []);

  // Callback to send a JSON-RPC response
  const sendResponse = useCallback((id: string | number, result: unknown) => {
    sendToIframe({
      jsonrpc: "2.0",
      id,
      result,
    });
  }, [sendToIframe]);

  // Callback to send a JSON-RPC error response
  const sendErrorResponse = useCallback((id: string | number, code: number, message: string) => {
    sendToIframe({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    });
  }, [sendToIframe]);

  // Callback to send a notification
  const sendNotification = useCallback((method: string, params?: Record<string, unknown>) => {
    sendToIframe({
      jsonrpc: "2.0",
      method,
      params: params || {},
    });
  }, [sendToIframe]);

  // Effect 1: Setup sandbox proxy iframe and communication
  useEffect(() => {
    // Capture container reference at effect start (refs are cleared during unmount)
    const container = containerRef.current;
    if (!container) return;

    let mounted = true;
    let messageHandler: ((event: MessageEvent) => void) | null = null;
    let initialListener: ((event: MessageEvent) => void) | null = null;
    let createdIframe: HTMLIFrameElement | null = null;

    const setup = async () => {
      try {
        // Create sandbox proxy iframe
        const iframe = document.createElement("iframe");
        createdIframe = iframe; // Track for cleanup
        iframe.style.width = "100%";
        iframe.style.height = "100px"; // Start small, will be resized by size-changed notification
        iframe.style.border = "none";
        iframe.style.backgroundColor = "transparent";
        iframe.style.display = "block";
        iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");

        // Wait for sandbox proxy to be ready
        const sandboxReady = new Promise<void>((resolve) => {
          initialListener = (event: MessageEvent) => {
            if (event.source === iframe.contentWindow) {
              if (event.data?.method === "ui/notifications/sandbox-proxy-ready") {
                if (initialListener) {
                  window.removeEventListener("message", initialListener);
                  initialListener = null;
                }
                resolve();
              }
            }
          };
          window.addEventListener("message", initialListener);
        });

        // Check mounted before adding to DOM (handles StrictMode double-mount)
        if (!mounted) {
          if (initialListener) {
            window.removeEventListener("message", initialListener);
            initialListener = null;
          }
          return;
        }

        // Set iframe source and add to DOM
        iframe.src = "/sandbox.html";
        iframeRef.current = iframe;
        container.appendChild(iframe);

        // Wait for sandbox proxy to signal ready
        await sandboxReady;
        if (!mounted) return;

        console.log("[MCPAppsRenderer] Sandbox proxy ready");

        // Setup message handler for JSON-RPC messages from the inner iframe
        messageHandler = async (event: MessageEvent) => {
          if (event.source !== iframe.contentWindow) return;

          const msg = event.data as JSONRPCMessage;
          if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return;

          console.log("[MCPAppsRenderer] Received from iframe:", msg);

          // Handle requests (need response)
          if (isRequest(msg)) {
            switch (msg.method) {
              case "ui/initialize": {
                // Respond with host capabilities
                sendResponse(msg.id, {
                  protocolVersion: PROTOCOL_VERSION,
                  hostInfo: {
                    name: "CopilotKit MCP Apps Host",
                    version: "1.0.0",
                  },
                  hostCapabilities: {
                    openLinks: {},
                    logging: {},
                  },
                  hostContext: {
                    theme: "light",
                    platform: "web",
                  },
                });
                break;
              }

              case "ui/message": {
                // Add message to CopilotKit chat
                const currentAgent = agentRef.current;

                if (!currentAgent) {
                  console.warn("[MCPAppsRenderer] ui/message: No agent available");
                  sendResponse(msg.id, { isError: false });
                  break;
                }

                try {
                  const params = msg.params as {
                    role?: string;
                    content?: Array<{ type: string; text?: string }>;
                  };

                  // Extract text content from the message
                  const textContent = params.content
                    ?.filter((c) => c.type === "text" && c.text)
                    .map((c) => c.text)
                    .join("\n") || "";

                  if (textContent) {
                    currentAgent.addMessage({
                      id: crypto.randomUUID(),
                      role: (params.role as "user" | "assistant") || "user",
                      content: textContent,
                    });
                  }
                  sendResponse(msg.id, { isError: false });
                } catch (err) {
                  console.error("[MCPAppsRenderer] ui/message error:", err);
                  sendResponse(msg.id, { isError: true });
                }
                break;
              }

              case "ui/open-link": {
                // Open URL in new tab
                const url = msg.params?.url as string | undefined;
                if (url) {
                  window.open(url, "_blank", "noopener,noreferrer");
                  sendResponse(msg.id, { isError: false });
                } else {
                  sendErrorResponse(msg.id, -32602, "Missing url parameter");
                }
                break;
              }

              case "tools/call": {
                // Proxy tool call to MCP server via agent.runAgent()
                const { serverId } = contentRef.current;
                const currentAgent = agentRef.current;

                if (!serverId) {
                  sendErrorResponse(msg.id, -32603, "No server ID available for proxying");
                  break;
                }

                if (!currentAgent) {
                  sendErrorResponse(msg.id, -32603, "No agent available for proxying");
                  break;
                }

                try {
                  // Use agent.runAgent() to proxy the MCP request
                  // The middleware will intercept forwardedProps.__proxiedMCPRequest
                  const runResult = await currentAgent.runAgent({
                    forwardedProps: {
                      __proxiedMCPRequest: {
                        serverId,
                        method: "tools/call",
                        params: msg.params,
                      },
                    },
                  });

                  // The result from runAgent contains the MCP response
                  sendResponse(msg.id, runResult.result || {});
                } catch (err) {
                  console.error("[MCPAppsRenderer] tools/call error:", err);
                  sendErrorResponse(msg.id, -32603, String(err));
                }
                break;
              }

              default:
                sendErrorResponse(msg.id, -32601, `Method not found: ${msg.method}`);
            }
          }

          // Handle notifications (no response needed)
          if (isNotification(msg)) {
            switch (msg.method) {
              case "ui/notifications/initialized": {
                console.log("[MCPAppsRenderer] Inner iframe initialized");
                if (mounted) {
                  setIframeReady(true);
                }
                break;
              }

              case "ui/notifications/size-changed": {
                const { width, height } = msg.params || {};
                console.log("[MCPAppsRenderer] Size change:", { width, height });
                if (mounted) {
                  setIframeSize({
                    width: typeof width === "number" ? width : undefined,
                    height: typeof height === "number" ? height : undefined,
                  });
                }
                break;
              }

              case "notifications/message": {
                // Logging notification from the app
                console.log("[MCPAppsRenderer] App log:", msg.params);
                break;
              }
            }
          }
        };

        window.addEventListener("message", messageHandler);

        // Send the HTML resource to the sandbox proxy
        const html = extractHtmlFromResource(content.resource);
        sendNotification("ui/notifications/sandbox-resource-ready", { html });

      } catch (err) {
        console.error("[MCPAppsRenderer] Setup error:", err);
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    setup();

    return () => {
      mounted = false;
      // Clean up initial listener if still active
      if (initialListener) {
        window.removeEventListener("message", initialListener);
        initialListener = null;
      }
      if (messageHandler) {
        window.removeEventListener("message", messageHandler);
      }
      // Remove the iframe we created (using tracked reference, not DOM query)
      // This works even if containerRef.current is null during unmount
      if (createdIframe) {
        createdIframe.remove();
        createdIframe = null;
      }
      iframeRef.current = null;
    };
  }, [content.resource, sendNotification, sendResponse, sendErrorResponse]);

  // Effect 2: Update iframe size when it changes
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

  // Effect 3: Send tool input when iframe ready
  useEffect(() => {
    if (iframeReady && content.toolInput) {
      console.log("[MCPAppsRenderer] Sending tool input:", content.toolInput);
      sendNotification("ui/notifications/tool-input", {
        arguments: content.toolInput,
      });
    }
  }, [iframeReady, content.toolInput, sendNotification]);

  // Effect 4: Send tool result when iframe ready
  useEffect(() => {
    if (iframeReady && content.result) {
      console.log("[MCPAppsRenderer] Sending tool result:", content.result);
      sendNotification("ui/notifications/tool-result", content.result);
    }
  }, [iframeReady, content.result, sendNotification]);

  // Determine border styling based on prefersBorder metadata
  // true = show border/background, false = none, undefined = host decides (we default to none)
  const prefersBorder = content.resource._meta?.ui?.prefersBorder;
  const borderStyle = prefersBorder === true
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
        ...borderStyle,
      }}
    >
      {error && (
        <div style={{ color: "red", padding: "1rem" }}>
          Error: {error.message}
        </div>
      )}
    </div>
  );
};
