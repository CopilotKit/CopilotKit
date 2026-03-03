"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { z } from "zod";
import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";

// Protocol version supported
const PROTOCOL_VERSION = "2025-06-18";

// Build sandbox proxy HTML with optional extra CSP domains from resource metadata
function buildSandboxHTML(extraCspDomains?: string[]): string {
  const baseScriptSrc =
    "'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data: http://localhost:* https://localhost:*";
  const baseFrameSrc = "* blob: data: http://localhost:* https://localhost:*";
  const extra = extraCspDomains?.length ? " " + extraCspDomains.join(" ") : "";
  const scriptSrc = baseScriptSrc + extra;
  const frameSrc = baseFrameSrc + extra;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src * data: blob: 'unsafe-inline'; media-src * blob: data:; font-src * blob: data:; script-src ${scriptSrc}; style-src * blob: data: 'unsafe-inline'; connect-src *; frame-src ${frameSrc}; base-uri 'self';" />
<style>html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden}*{box-sizing:border-box}iframe{background-color:transparent;border:none;padding:0;overflow:hidden;width:100%;height:100%}</style>
</head>
<body>
<script>
if(window.self===window.top){throw new Error("This file must be used in an iframe.")}
const inner=document.createElement("iframe");
inner.style="width:100%;height:100%;border:none;";
inner.setAttribute("sandbox","allow-scripts allow-same-origin allow-forms");
document.body.appendChild(inner);
window.addEventListener("message",async(event)=>{
if(event.source===window.parent){
if(event.data&&event.data.method==="ui/notifications/sandbox-resource-ready"){
const{html,sandbox}=event.data.params;
if(typeof sandbox==="string")inner.setAttribute("sandbox",sandbox);
if(typeof html==="string")inner.srcdoc=html;
}else if(inner&&inner.contentWindow){
inner.contentWindow.postMessage(event.data,"*");
}
}else if(event.source===inner.contentWindow){
window.parent.postMessage(event.data,"*");
}
});
window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/sandbox-proxy-ready",params:{}},"*");
</script>
</body>
</html>`;
}

/**
 * Queue for serializing MCP app requests to an agent.
 * Ensures requests wait for the agent to stop running and are processed one at a time.
 */
class MCPAppsRequestQueue {
  private queues = new Map<
    string,
    Array<{
      execute: () => Promise<RunAgentResult>;
      resolve: (result: RunAgentResult) => void;
      reject: (error: Error) => void;
    }>
  >();
  private processing = new Map<string, boolean>();

  /**
   * Add a request to the queue for a specific agent thread.
   * Returns a promise that resolves when the request completes.
   */
  async enqueue(
    agent: AbstractAgent,
    request: () => Promise<RunAgentResult>,
  ): Promise<RunAgentResult> {
    const threadId = agent.threadId || "default";

    return new Promise((resolve, reject) => {
      // Get or create queue for this thread
      let queue = this.queues.get(threadId);
      if (!queue) {
        queue = [];
        this.queues.set(threadId, queue);
      }

      // Add request to queue
      queue.push({ execute: request, resolve, reject });

      // Start processing if not already running
      this.processQueue(threadId, agent);
    });
  }

  private async processQueue(
    threadId: string,
    agent: AbstractAgent,
  ): Promise<void> {
    // If already processing this queue, return
    if (this.processing.get(threadId)) {
      return;
    }

    this.processing.set(threadId, true);

    try {
      const queue = this.queues.get(threadId);
      if (!queue) return;

      while (queue.length > 0) {
        const item = queue[0]!;

        try {
          // Wait for any active run to complete before processing
          await this.waitForAgentIdle(agent);

          // Execute the request
          const result = await item.execute();
          item.resolve(result);
        } catch (error) {
          item.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }

        // Remove processed item
        queue.shift();
      }
    } finally {
      this.processing.set(threadId, false);
    }
  }

  private waitForAgentIdle(agent: AbstractAgent): Promise<void> {
    return new Promise((resolve) => {
      if (!agent.isRunning) {
        resolve();
        return;
      }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(checkInterval);
        sub.unsubscribe();
        resolve();
      };

      const sub = agent.subscribe({
        onRunFinalized: finish,
        onRunFailed: finish,
      });

      // Fallback for reconnect scenarios where events don't fire
      const checkInterval = setInterval(() => {
        if (!agent.isRunning) finish();
      }, 500);
    });
  }
}

// Global queue instance for all MCP app requests
const mcpAppsRequestQueue = new MCPAppsRequestQueue();

/**
 * Activity type for MCP Apps events - must match the middleware's MCPAppsActivityType
 */
export const MCPAppsActivityType = "mcp-apps";

// Zod schema for activity content validation (middleware 0.0.2 format)
export const MCPAppsActivityContentSchema = z.object({
  result: z.object({
    content: z.array(z.any()).optional(),
    structuredContent: z.any().optional(),
    isError: z.boolean().optional(),
  }),
  // Resource URI to fetch (e.g., "ui://server/dashboard")
  resourceUri: z.string(),
  // MD5 hash of server config (renamed from serverId in 0.0.1)
  serverHash: z.string(),
  // Optional stable server ID from config (takes precedence over serverHash)
  serverId: z.string().optional(),
  // Original tool input arguments
  toolInput: z.record(z.unknown()).optional(),
});

export type MCPAppsActivityContent = z.infer<
  typeof MCPAppsActivityContentSchema
>;

// Type for the resource fetched from the server
interface FetchedResource {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: {
    ui?: {
      prefersBorder?: boolean;
      csp?: {
        connectDomains?: string[];
        resourceDomains?: string[];
      };
    };
  };
}

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
 * Fetches resource content on-demand via proxied MCP requests.
 */
export const MCPAppsActivityRenderer: React.FC<MCPAppsActivityRendererProps> =
  function MCPAppsActivityRenderer({ content, agent }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const [iframeReady, setIframeReady] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [iframeSize, setIframeSize] = useState<{
      width?: number;
      height?: number;
    }>({});
    const [fetchedResource, setFetchedResource] =
      useState<FetchedResource | null>(null);

    // Use refs for values that shouldn't trigger re-renders but need latest values
    const contentRef = useRef(content);
    contentRef.current = content;

    // Store agent in a ref for use in async handlers
    const agentRef = useRef(agent);
    agentRef.current = agent;

    // Ref to track fetch state - survives StrictMode remounts
    const fetchStateRef = useRef<{
      inProgress: boolean;
      promise: Promise<FetchedResource | null> | null;
      resourceUri: string | null;
    }>({ inProgress: false, promise: null, resourceUri: null });

    // Callback to send a message to the iframe
    const sendToIframe = useCallback((msg: JSONRPCMessage) => {
      if (iframeRef.current?.contentWindow) {
        console.log("[MCPAppsRenderer] Sending to iframe:", msg);
        iframeRef.current.contentWindow.postMessage(msg, "*");
      }
    }, []);

    // Callback to send a JSON-RPC response
    const sendResponse = useCallback(
      (id: string | number, result: unknown) => {
        sendToIframe({
          jsonrpc: "2.0",
          id,
          result,
        });
      },
      [sendToIframe],
    );

    // Callback to send a JSON-RPC error response
    const sendErrorResponse = useCallback(
      (id: string | number, code: number, message: string) => {
        sendToIframe({
          jsonrpc: "2.0",
          id,
          error: { code, message },
        });
      },
      [sendToIframe],
    );

    // Callback to send a notification
    const sendNotification = useCallback(
      (method: string, params?: Record<string, unknown>) => {
        sendToIframe({
          jsonrpc: "2.0",
          method,
          params: params || {},
        });
      },
      [sendToIframe],
    );

    // Effect 0: Fetch the resource content on mount
    // Uses ref-based deduplication to handle React StrictMode double-mounting
    useEffect(() => {
      const { resourceUri, serverHash, serverId } = content;

      // Check if we already have a fetch in progress for this resource
      // This handles StrictMode double-mounting - second mount reuses first mount's promise
      if (
        fetchStateRef.current.inProgress &&
        fetchStateRef.current.resourceUri === resourceUri
      ) {
        // Reuse the existing promise
        fetchStateRef.current.promise
          ?.then((resource) => {
            if (resource) {
              setFetchedResource(resource);
              setIsLoading(false);
            }
          })
          .catch((err) => {
            setError(err instanceof Error ? err : new Error(String(err)));
            setIsLoading(false);
          });
        return;
      }

      if (!agent) {
        setError(new Error("No agent available to fetch resource"));
        setIsLoading(false);
        return;
      }

      // Mark fetch as in progress
      fetchStateRef.current.inProgress = true;
      fetchStateRef.current.resourceUri = resourceUri;

      // Create the fetch promise using the queue to serialize requests
      const fetchPromise = (async (): Promise<FetchedResource | null> => {
        try {
          // Use queue to wait for agent to be idle and serialize requests
          const runResult = await mcpAppsRequestQueue.enqueue(agent, () =>
            agent.runAgent({
              forwardedProps: {
                __proxiedMCPRequest: {
                  serverHash,
                  serverId, // optional, takes precedence if provided
                  method: "resources/read",
                  params: { uri: resourceUri },
                },
              },
            }),
          );

          // Extract resource from result
          // The response format is: { contents: [{ uri, mimeType, text?, blob?, _meta? }] }
          const resultData = runResult.result as
            | { contents?: FetchedResource[] }
            | undefined;
          const resource = resultData?.contents?.[0];

          if (!resource) {
            throw new Error("No resource content in response");
          }

          return resource;
        } catch (err) {
          console.error("[MCPAppsRenderer] Failed to fetch resource:", err);
          throw err;
        } finally {
          // Mark fetch as complete
          fetchStateRef.current.inProgress = false;
        }
      })();

      // Store the promise for potential reuse
      fetchStateRef.current.promise = fetchPromise;

      // Handle the result
      fetchPromise
        .then((resource) => {
          if (resource) {
            setFetchedResource(resource);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        });

      // No cleanup needed - we want the fetch to complete even if StrictMode unmounts
    }, [agent, content]);

    // Effect 1: Setup sandbox proxy iframe and communication (after resource is fetched)
    useEffect(() => {
      // Wait for resource to be fetched
      if (isLoading || !fetchedResource) {
        return;
      }

      // Capture container reference at effect start (refs are cleared during unmount)
      const container = containerRef.current;
      if (!container) {
        return;
      }

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
          iframe.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-forms",
          );

          // Wait for sandbox proxy to be ready
          const sandboxReady = new Promise<void>((resolve) => {
            initialListener = (event: MessageEvent) => {
              if (event.source === iframe.contentWindow) {
                if (
                  event.data?.method === "ui/notifications/sandbox-proxy-ready"
                ) {
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

          // Build sandbox HTML with CSP domains from resource metadata
          const cspDomains = fetchedResource._meta?.ui?.csp?.resourceDomains;
          iframe.srcdoc = buildSandboxHTML(cspDomains);
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
            if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0")
              return;

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
                    console.warn(
                      "[MCPAppsRenderer] ui/message: No agent available",
                    );
                    sendResponse(msg.id, { isError: false });
                    break;
                  }

                  try {
                    const params = msg.params as {
                      role?: string;
                      content?: Array<{ type: string; text?: string }>;
                    };

                    // Extract text content from the message
                    const textContent =
                      params.content
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
                  const { serverHash, serverId } = contentRef.current;
                  const currentAgent = agentRef.current;

                  if (!serverHash) {
                    sendErrorResponse(
                      msg.id,
                      -32603,
                      "No server hash available for proxying",
                    );
                    break;
                  }

                  if (!currentAgent) {
                    sendErrorResponse(
                      msg.id,
                      -32603,
                      "No agent available for proxying",
                    );
                    break;
                  }

                  try {
                    // Use queue to wait for agent to be idle and serialize requests
                    const runResult = await mcpAppsRequestQueue.enqueue(
                      currentAgent,
                      () =>
                        currentAgent.runAgent({
                          forwardedProps: {
                            __proxiedMCPRequest: {
                              serverHash,
                              serverId, // optional, takes precedence if provided
                              method: "tools/call",
                              params: msg.params,
                            },
                          },
                        }),
                    );

                    // The result from runAgent contains the MCP response
                    sendResponse(msg.id, runResult.result || {});
                  } catch (err) {
                    console.error("[MCPAppsRenderer] tools/call error:", err);
                    sendErrorResponse(msg.id, -32603, String(err));
                  }
                  break;
                }

                default:
                  sendErrorResponse(
                    msg.id,
                    -32601,
                    `Method not found: ${msg.method}`,
                  );
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
                  console.log("[MCPAppsRenderer] Size change:", {
                    width,
                    height,
                  });
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

          // Extract HTML content from fetched resource
          let html: string;
          if (fetchedResource.text) {
            html = fetchedResource.text;
          } else if (fetchedResource.blob) {
            html = atob(fetchedResource.blob);
          } else {
            throw new Error("Resource has no text or blob content");
          }

          // Send the resource content to the sandbox proxy
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
    }, [
      isLoading,
      fetchedResource,
      sendNotification,
      sendResponse,
      sendErrorResponse,
    ]);

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
