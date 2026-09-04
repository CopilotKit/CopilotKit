import {
  AppBridge,
  LATEST_PROTOCOL_VERSION,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { AbstractAgent } from "@ag-ui/client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { randomUUID } from "@copilotkit/shared";
import { buildSandboxHTML } from "./sandbox";
import { mcpAppsRequestQueue } from "./request-queue";
import { ɵrunMcpFollowUp } from "./follow-up";
import type { ɵMcpFollowUpHost } from "./follow-up";
import { MCP_OPEN_LINK_BLOCKED_SCHEMES } from "./constants";
import type { MCPAppsActivityContent } from "./content-schema";

/**
 * The MCP Apps protocol version this host negotiates. Sourced directly from the
 * ext-apps bridge (single source of truth, no hand-maintained literal). It lives
 * here (a bridge-side module) rather than in the bridge-free `./constants` /
 * `./activity` entry so the lightweight activity-registration surface stays free
 * of the ext-apps bundle; consumers that need the version import it from the
 * package root, which already loads the bridge.
 */
export const MCP_APPS_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

/**
 * Permissive `ui/message` schema. ext-apps restricts the request to
 * `role: "user"` with no `followUp`, but CopilotKit intentionally extends
 * `ui/message` with `role` ("user" | "assistant") and `followUp` (documented
 * behavior with dedicated tests). We register our own handler (instead of the
 * bridge's strict `onmessage`) so those extensions survive.
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

/** A resource fetched from the MCP server via the agent proxy. */
export interface FetchedResource {
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

/** Reactive callbacks the framework adapter wires to its own state. */
export interface McpAppSessionHooks {
  /** The widget reported a new content size (ui/notifications/size-changed). */
  onSizeChanged?(size: { width?: number; height?: number }): void;
  /** The widget finished initializing (safe to push tool input/result). */
  onInitialized?(): void;
  /** The fetched resource metadata (e.g. prefersBorder) is available. */
  onResource?(resource: FetchedResource): void;
  /** Setup failed (resource fetch, connect, ...). */
  onError?(err: Error): void;
}

export interface BindMcpAppOptions {
  /**
   * The sandbox iframe. The adapter creates and OWNS this element (mounts it in
   * its render model, sizes it, removes it on unmount). The session only
   * configures the sandbox contract (sandbox attr, testid, srcdoc) and talks to
   * it through the bridge - it never creates, moves, or removes the iframe.
   */
  iframe: HTMLIFrameElement;
  /** Returns the current activity content (resourceUri, serverHash, tool input/result). */
  getContent: () => MCPAppsActivityContent;
  /** Returns the current agent (may change across renders). */
  getAgent: () => AbstractAgent | undefined;
  /** CopilotKit host, for ui/message follow-up runs (issue #5819). */
  host: ɵMcpFollowUpHost;
  hooks?: McpAppSessionHooks;
}

export interface McpAppSession {
  /** Forward the tool call input to the widget (host -> app). Buffered until ready. */
  sendToolInput(args: Record<string, unknown>): void;
  /** Forward the tool result to the widget (host -> app). Buffered until ready. */
  sendToolResult(result: CallToolResult): void;
  /** Disconnect the bridge and release listeners. Does NOT remove the iframe. */
  teardown(): void;
}

/**
 * Bind an MCP App to a host-provided sandbox iframe: fetch the widget resource
 * through the agent, connect the ext-apps `AppBridge` over a PostMessage
 * transport, and wire the app<->host protocol (ui/message, ui/open-link,
 * tools/call + resources/read proxy, size, host context). Framework-agnostic:
 * the React/Vue/Angular renderers create the iframe and wire reactive state via
 * `hooks`, but all protocol logic lives here.
 */
export function bindMcpApp(opts: BindMcpAppOptions): McpAppSession {
  const { iframe, getContent, getAgent, host, hooks } = opts;

  let disposed = false;
  let ready = false;
  let bridge: AppBridge | null = null;
  let pendingToolInput: Record<string, unknown> | undefined;
  let pendingToolResult: CallToolResult | undefined;

  const flushPending = () => {
    if (!ready || !bridge) return;
    if (pendingToolInput !== undefined) {
      void bridge.sendToolInput({ arguments: pendingToolInput });
      pendingToolInput = undefined;
    }
    if (pendingToolResult !== undefined) {
      void bridge.sendToolResult(pendingToolResult);
      pendingToolResult = undefined;
    }
  };

  const fetchResource = async (): Promise<FetchedResource> => {
    const agent = getAgent();
    if (!agent) {
      throw new Error("No agent available to fetch resource");
    }
    const { resourceUri, serverHash, serverId } = getContent();
    const runResult = await mcpAppsRequestQueue.enqueue(agent, () =>
      agent.runAgent({
        forwardedProps: {
          __proxiedMCPRequest: {
            serverHash,
            serverId,
            method: "resources/read",
            params: { uri: resourceUri },
          },
        },
      }),
    );
    const resultData = runResult.result as
      | { contents?: FetchedResource[] }
      | undefined;
    const resource = resultData?.contents?.[0];
    if (!resource) {
      throw new Error("No resource content in response");
    }
    return resource;
  };

  const setup = async () => {
    try {
      const resource = await fetchResource();
      if (disposed) return;
      hooks?.onResource?.(resource);

      // Configure the sandbox iframe (contract shared across frontends).
      iframe.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-forms",
      );
      // Cross-frontend MCP-apps surface contract: every frontend must expose the
      // sandbox iframe under the SAME testid so one shared probe (harness
      // `d5-mcp-apps`) and one shared e2e spec can assert the surface mounted
      // without per-frontend selectors.
      iframe.setAttribute("data-testid", "mcp-app-iframe");
      iframe.setAttribute("title", "Interactive MCP application");

      const cspDomains = resource._meta?.ui?.csp?.resourceDomains;
      iframe.srcdoc = buildSandboxHTML(cspDomains);

      const win = iframe.contentWindow;
      if (!win) {
        throw new Error("Sandbox iframe has no contentWindow");
      }

      let html: string;
      if (resource.text) {
        html = resource.text;
      } else if (resource.blob) {
        html = atob(resource.blob);
      } else {
        throw new Error("Resource has no text or blob content");
      }

      bridge = new AppBridge(
        null,
        { name: "CopilotKit MCP Apps Host", version: "1.0.0" },
        { openLinks: {}, logging: {}, message: { text: {} } },
        // Seed the host context at construction so it is already in place when
        // the widget's ui/initialize is handled (deterministic, not a race).
        { hostContext: { theme: "light", platform: "web" } },
      );

      // Sandbox handshake: on proxy ready, load the widget HTML into the inner
      // sandboxed iframe.
      bridge.onsandboxready = () => {
        void bridge?.sendSandboxResourceReady({ html });
      };

      // --- App -> host requests ---
      // ui/message: custom handler preserving CopilotKit role/followUp extensions
      // (via _meta.copilotkit first, then legacy top-level fields).
      bridge.setRequestHandler(CopilotKitUiMessageSchema, async (req) => {
        const currentAgent = getAgent();
        if (!currentAgent) {
          console.warn("[MCPAppsRenderer] ui/message: No agent available");
          return { isError: false };
        }
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
              id: randomUUID(),
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
                  host,
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
        // The bridge validates `url` as a string but not the scheme. Block only
        // the script-executing / attacker-HTML schemes; everything else
        // (https universal links, custom-scheme deep links) is allowed.
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          console.warn(
            "[MCPAppsRenderer] ui/open-link rejected: unparseable url",
          );
          return { isError: true };
        }
        if (MCP_OPEN_LINK_BLOCKED_SCHEMES.has(parsed.protocol)) {
          console.warn(
            "[MCPAppsRenderer] ui/open-link rejected: blocked scheme",
            parsed.protocol,
          );
          return { isError: true };
        }
        window.open(url, "_blank", "noopener,noreferrer");
        return { isError: false };
      };

      bridge.oncalltool = async (params) => {
        const { serverHash, serverId } = getContent();
        const currentAgent = getAgent();
        if (!serverHash) {
          throw new Error("No server hash available for proxying");
        }
        if (!currentAgent) {
          throw new Error("No agent available for proxying");
        }
        const runResult = await mcpAppsRequestQueue.enqueue(currentAgent, () =>
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
        if (disposed) return;
        const { width, height } = (p || {}) as {
          width?: number;
          height?: number;
        };
        hooks?.onSizeChanged?.({
          width: typeof width === "number" ? width : undefined,
          height: typeof height === "number" ? height : undefined,
        });
      };
      bridge.oninitialized = () => {
        if (disposed) return;
        ready = true;
        hooks?.onInitialized?.();
        flushPending();
      };
      bridge.onloggingmessage = (p) => {
        console.log("[MCPAppsRenderer] App log:", p);
      };

      const transport = new PostMessageTransport(win, win);
      await bridge.connect(transport);
      if (disposed) {
        await bridge.close();
        bridge = null;
        return;
      }
    } catch (err) {
      console.error("[MCPAppsRenderer] Setup error:", err);
      if (!disposed) {
        hooks?.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  void setup();

  return {
    sendToolInput(args) {
      pendingToolInput = args;
      flushPending();
    },
    sendToolResult(result) {
      pendingToolResult = result;
      flushPending();
    },
    teardown() {
      disposed = true;
      const b = bridge;
      bridge = null;
      void b?.close();
    },
  };
}
