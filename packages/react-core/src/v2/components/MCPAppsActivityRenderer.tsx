"use client";

import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
// Type-only import: the ext-apps bridge is a heavy dependency (it pulls the MCP
// SDK Protocol + zod schemas, ~40-50 kB gzipped). It is loaded lazily via a
// dynamic import() inside Effect 1 so that a `<CopilotKit>` app only pays for it
// when it actually renders an MCP App, not on every mount.
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { useCopilotKit } from "../providers/CopilotKitProvider";

/**
 * The subset of `CopilotKitCore` that {@link ɵrunMcpFollowUp} depends on.
 * Declared structurally so the runner can be unit-tested without a full core.
 */
export interface ɵMcpFollowUpHost {
  runAgent(params: { agent: AbstractAgent }): Promise<RunAgentResult>;
}

/**
 * Run an MCP app `ui/message` follow-up, scoped to the thread it was enqueued
 * for (issue #5819).
 *
 * The MCP request queue delays follow-up work until the agent is idle. There is
 * a single shared registry agent per id, and switching threads overwrites its
 * `threadId`/`messages` in place. So if the host switches threads while a
 * follow-up is queued, running it now would execute against — and stream into —
 * the now-foreground thread.
 *
 * - **Same thread** (the common case): run on the shared agent, unchanged.
 * - **Thread changed**: the shared agent has moved on, so the follow-up can no
 *   longer run in its originating thread's context. Drop it rather than leak it
 *   into the current thread. (The MCP app already received its `ui/message` ack
 *   at enqueue time; only the optional agent turn is skipped.)
 *
 * @internal exported for testing.
 */
export async function ɵrunMcpFollowUp({
  host,
  agent,
  capturedThreadId,
}: {
  host: ɵMcpFollowUpHost;
  agent: AbstractAgent;
  capturedThreadId: string;
}): Promise<RunAgentResult> {
  const currentThreadId = agent.threadId || "default";
  const originThreadId = capturedThreadId || "default";

  if (currentThreadId === originThreadId) {
    return host.runAgent({ agent });
  }

  console.warn(
    "[MCPAppsRenderer] ui/message follow-up dropped: the thread changed " +
      `(${originThreadId} → ${currentThreadId}) between enqueue and execution, ` +
      "so running it would leak into the now-foreground thread.",
  );
  return { result: undefined, newMessages: [] };
}

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
  toolInput: z.record(z.string(), z.unknown()).optional(),
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
/**
 * Permissive `ui/message` schema. ext-apps restricts the request to
 * `role: "user"` with no `followUp`, but CopilotKit intentionally extends
 * `ui/message` with `role` ("user" | "assistant") and `followUp` (documented
 * behavior with dedicated tests). We register our own handler (instead of the
 * bridge's strict `onmessage`) so those extensions survive the migration.
 *
 * Going forward, widgets SHOULD pass the extensions under
 * `params._meta.copilotkit`; the top-level `role`/`followUp` fields are the
 * legacy channel, kept for backward compatibility and slated for deprecation.
 */
const CopilotKitUiMessageSchema = z.object({
  method: z.literal("ui/message"),
  params: z
    .object({
      role: z.string().optional(),
      content: z.array(z.any()).optional(),
      followUp: z.boolean().optional(),
      _meta: z.record(z.string(), z.any()).optional(),
    })
    .passthrough(),
});

export const MCPAppsActivityRenderer: React.FC<MCPAppsActivityRendererProps> =
  function MCPAppsActivityRenderer({ content, agent }) {
    const { copilotkit } = useCopilotKit();
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

    // ext-apps host bridge for this widget instance (owns the app<->host protocol).
    const bridgeRef = useRef<AppBridge | null>(null);

    // Ref to track fetch state - survives StrictMode remounts
    const fetchStateRef = useRef<{
      inProgress: boolean;
      promise: Promise<FetchedResource | null> | null;
      resourceUri: string | null;
    }>({ inProgress: false, promise: null, resourceUri: null });

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

    // Effect 1: connect the ext-apps AppBridge to the sandboxed iframe.
    // The bridge owns the app<->host protocol (initialize/capabilities/context,
    // requests, notifications, tool input/result) over a PostMessage transport.
    useEffect(() => {
      if (isLoading || !fetchedResource) {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }

      let mounted = true;
      let bridge: AppBridge | null = null;
      let createdIframe: HTMLIFrameElement | null = null;

      const setup = async () => {
        try {
          // Create the sandbox proxy iframe (the proxy relays postMessage between
          // the host and the inner sandboxed widget).
          const iframe = document.createElement("iframe");
          createdIframe = iframe;
          iframe.style.width = "100%";
          iframe.style.height = "100px";
          iframe.style.border = "none";
          iframe.style.backgroundColor = "transparent";
          iframe.style.display = "block";
          iframe.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-forms",
          );
          // Cross-frontend MCP-apps surface contract: the host-created sandbox
          // iframe is the addressable render surface for the MCP app, and every
          // frontend must expose it under the SAME testid so one shared probe
          // (harness `d5-mcp-apps`) and one shared e2e spec can assert the
          // surface mounted without per-frontend selectors. Angular declares
          // the same pair on its `copilot-mcp-apps-widget` template iframe;
          // Vue's renderer mirrors this block.
          iframe.setAttribute("data-testid", "mcp-app-iframe");
          iframe.setAttribute("title", "Interactive MCP application");

          const cspDomains = fetchedResource._meta?.ui?.csp?.resourceDomains;
          iframe.srcdoc = buildSandboxHTML(cspDomains);
          iframeRef.current = iframe;
          container.appendChild(iframe);

          const win = iframe.contentWindow;
          if (!win) {
            throw new Error("Sandbox iframe has no contentWindow");
          }

          // Extract the widget HTML from the fetched resource. Done after the
          // iframe is mounted so a resource missing text/blob still leaves the
          // sandbox surface present (it just never receives content).
          let html: string;
          if (fetchedResource.text) {
            html = fetchedResource.text;
          } else if (fetchedResource.blob) {
            html = atob(fetchedResource.blob);
          } else {
            throw new Error("Resource has no text or blob content");
          }

          // Lazily load the ext-apps bridge so it stays out of the base bundle
          // (see the import-type note at the top of this file).
          const { AppBridge, PostMessageTransport } =
            await import("@modelcontextprotocol/ext-apps/app-bridge");
          if (!mounted) {
            return;
          }

          bridge = new AppBridge(
            null,
            { name: "CopilotKit MCP Apps Host", version: "1.0.0" },
            { openLinks: {}, logging: {}, message: { text: {} } },
            // Seed the host context at construction (before connect) so it is
            // already in place when the widget's ui/initialize is handled. Doing
            // this via setHostContext after connect would only win the race by
            // luck (it depends on the notification landing before initialize),
            // and #6689 relies on this seam to advertise displayMode /
            // availableDisplayModes at initialize.
            { hostContext: { theme: "light", platform: "web" } },
          );

          // Sandbox handshake: when the proxy is ready, load the widget HTML into
          // the inner sandboxed iframe.
          bridge.onsandboxready = () => {
            void bridge?.sendSandboxResourceReady({ html });
          };

          // --- App -> host requests ---
          // ui/message uses a custom handler (not the bridge's strict onmessage)
          // to preserve CopilotKit's role/followUp extensions. Extensions are read
          // from params._meta.copilotkit first (preferred), then from the legacy
          // top-level params.role / params.followUp (deprecated).
          bridge.setRequestHandler(CopilotKitUiMessageSchema, async (req) => {
            const currentAgent = agentRef.current;
            if (!currentAgent) return { isError: false };
            try {
              const params = req.params;
              const ck = (params._meta?.copilotkit ?? {}) as {
                role?: string;
                followUp?: boolean;
              };
              const role =
                (ck.role as "user" | "assistant") ||
                (params.role as "user" | "assistant") ||
                "user";
              const textContent =
                (
                  params.content as
                    | Array<{ type: string; text?: string }>
                    | undefined
                )
                  ?.filter((c) => c.type === "text" && c.text)
                  .map((c) => c.text)
                  .join("\n") || "";
              if (textContent) {
                currentAgent.addMessage({
                  id: crypto.randomUUID(),
                  role,
                  content: textContent,
                });
              }
              const followUp = ck.followUp ?? params.followUp;
              const shouldFollowUp = followUp ?? role === "user";
              if (shouldFollowUp && textContent) {
                const capturedThreadId = currentAgent.threadId || "default";
                mcpAppsRequestQueue
                  .enqueue(currentAgent, () =>
                    ɵrunMcpFollowUp({
                      host: copilotkit,
                      agent: currentAgent,
                      capturedThreadId,
                    }),
                  )
                  .catch((err) =>
                    console.error(
                      "[MCPAppsRenderer] ui/message agent run failed:",
                      err,
                    ),
                  );
              }
              return { isError: false };
            } catch (err) {
              console.error("[MCPAppsRenderer] ui/message error:", err);
              return { isError: true };
            }
          });

          bridge.onopenlink = async ({ url }) => {
            // `url` is guaranteed by the bridge's ui/open-link schema; a request
            // without it is rejected by schema validation before this runs.
            window.open(url, "_blank", "noopener,noreferrer");
            return { isError: false };
          };

          bridge.oncalltool = async (params) => {
            const { serverHash, serverId } = contentRef.current;
            const currentAgent = agentRef.current;
            // Keep these two failures distinct: they point at different setup
            // problems when debugging the proxy wiring.
            if (!serverHash) {
              throw new Error("No server hash available for proxying");
            }
            if (!currentAgent) {
              throw new Error("No agent available for proxying");
            }
            const runResult = await mcpAppsRequestQueue.enqueue(
              currentAgent,
              () =>
                currentAgent.runAgent({
                  forwardedProps: {
                    __proxiedMCPRequest: {
                      serverHash,
                      serverId,
                      method: "tools/call",
                      params,
                    },
                  },
                }),
            );
            return (runResult.result as CallToolResult) || { content: [] };
          };

          // --- App -> host notifications ---
          bridge.onsizechange = (p) => {
            if (!mounted) return;
            const { width, height } = p || {};
            setIframeSize({
              width: typeof width === "number" ? width : undefined,
              height: typeof height === "number" ? height : undefined,
            });
          };
          bridge.oninitialized = () => {
            if (mounted) setIframeReady(true);
          };
          bridge.onloggingmessage = (p) => {
            console.log("[MCPAppsRenderer] App log:", p);
          };

          const transport = new PostMessageTransport(win, win);
          await bridge.connect(transport);
          if (!mounted) {
            await bridge.close();
            return;
          }
          // Host context was seeded at construction (see the AppBridge options
          // above), so it is already advertised by the time ui/initialize runs.
          bridgeRef.current = bridge;
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
        bridgeRef.current = null;
        void bridge?.close();
        if (createdIframe) {
          createdIframe.remove();
          createdIframe = null;
        }
        iframeRef.current = null;
      };
    }, [isLoading, fetchedResource, copilotkit]);

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
        void bridgeRef.current?.sendToolInput({
          arguments: content.toolInput as Record<string, unknown>,
        });
      }
    }, [iframeReady, content.toolInput]);

    // Effect 4: Send tool result when iframe ready
    useEffect(() => {
      if (iframeReady && content.result) {
        void bridgeRef.current?.sendToolResult(
          content.result as CallToolResult,
        );
      }
    }, [iframeReady, content.result]);

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
