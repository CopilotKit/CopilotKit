import { isPlatformBrowser } from "@angular/common";
import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { CopilotKit } from "@copilotkit/angular";
import { randomUUID } from "@copilotkit/shared";
import { type MCPAppsSnapshotContent } from "./mcp-apps-content";
import {
  MCPAppsQueueCancelledError,
  MCPAppsQueueThreadChangedError,
  MCPAppsRequestQueue,
} from "./mcp-apps-request-queue";
import { MCP_APPS_CONFIG } from "./mcp-apps-config";

const PROTOCOL_VERSION = "2025-06-18";

/**
 * CSP source expression for the package-owned inline MCP sandbox proxy.
 *
 * Hosts with a response-level `script-src` directive must include this value
 * or the browser will block the fallback `srcdoc` proxy before its handshake
 * begins. Strict-CSP hosts should prefer `MCPAppsConfig.sandboxProxyUrl` so
 * the embedded app does not inherit the main document's response policy.
 */
export const MCP_APPS_SANDBOX_SCRIPT_CSP_SOURCE =
  "'sha256-JFmPmlQxrmhhuJzvQorRReZp7gfZzK0a6+nkL8PPOwA='";

const queuesByIdleTimeout = new Map<number, MCPAppsRequestQueue>();

interface FetchedResource {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: {
    ui?: {
      prefersBorder?: boolean;
      csp?: { resourceDomains?: string[] };
    };
  };
}

interface JSONRPCMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Renders one MCP App snapshot through the same agent-mediated protocol used
 * by the other CopilotKit frontends. Each instance owns its queued work and
 * sandbox listener, while requests remain serialized per agent thread.
 */
@Component({
  selector: "copilot-mcp-apps-widget",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="copilot-mcp-apps-container">
      @if (loading()) {
        <p class="copilot-mcp-apps-status" role="status" aria-live="polite">
          Loading MCP App…
        </p>
      }
      @if (error()) {
        <p class="copilot-mcp-apps-error" role="alert">{{ error() }}</p>
      }
      <iframe
        #appFrame
        class="copilot-mcp-apps-frame"
        data-testid="mcp-app-iframe"
        title="Interactive MCP application"
      ></iframe>
    </div>
  `,
  styles: `
    .copilot-mcp-apps-container {
      position: relative;
      width: 100%;
      min-height: 100px;
      overflow: hidden;
    }

    .copilot-mcp-apps-frame {
      display: block;
      width: 100%;
      min-height: 100px;
      border: 0;
      background: transparent;
    }

    .copilot-mcp-apps-status,
    .copilot-mcp-apps-error {
      margin: 0;
      padding: 16px;
    }

    .copilot-mcp-apps-status {
      color: #525252;
    }

    .copilot-mcp-apps-error {
      color: #991b1b;
    }
  `,
})
export class CopilotMCPAppsWidget {
  private readonly config = inject(MCP_APPS_CONFIG);
  private readonly copilotKit = inject(CopilotKit);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ownerId = randomUUID();
  private readonly queue = queueForTimeout(this.config.idleTimeoutMs);
  private renderVersion = 0;

  readonly data = input.required<MCPAppsSnapshotContent>();
  readonly agent = input<AbstractAgent | undefined>();

  private readonly renderSession = computed(
    () => ({ agent: this.agent(), data: this.data() }),
    {
      equal: (previous, current) =>
        previous.agent === current.agent &&
        areStructurallyEqual(previous.data, current.data),
    },
  );

  private readonly appFrame =
    viewChild.required<ElementRef<HTMLIFrameElement>>("appFrame");
  protected readonly loading = signal(true);
  protected readonly error = signal("");

  constructor() {
    afterRenderEffect((onCleanup) => {
      const frame = this.appFrame().nativeElement;
      const { data, agent } = this.renderSession();
      const version = ++this.renderVersion;
      const controller = new AbortController();

      this.queue.cancelOwner(this.ownerId);
      this.resetFrame(frame);

      onCleanup(() => {
        controller.abort();
        this.queue.cancelOwner(this.ownerId);
        frame.removeAttribute("srcdoc");
        frame.removeAttribute("src");
        frame.removeAttribute("data-mcp-app-initialized");
      });

      if (!isPlatformBrowser(this.platformId)) {
        this.loading.set(false);
        return;
      }

      void this.renderApp(frame, data, agent, controller, version);
    });
  }

  private async renderApp(
    frame: HTMLIFrameElement,
    data: MCPAppsSnapshotContent,
    agent: AbstractAgent | undefined,
    controller: AbortController,
    version: number,
  ): Promise<void> {
    if (!agent) {
      this.fail("No agent is available to load this MCP App.", frame, version);
      return;
    }

    try {
      const runResult = await this.queue.enqueue({
        agent,
        ownerId: this.ownerId,
        execute: () =>
          agent.runAgent({
            forwardedProps: {
              __proxiedMCPRequest: {
                serverHash: data.serverHash,
                serverId: data.serverId,
                method: "resources/read",
                params: { uri: data.resourceUri },
              },
            },
          }),
      });
      this.throwIfStale(controller.signal, version);

      const resource = findResource(runResult, data.resourceUri);
      const html = resource.text
        ? resource.text
        : resource.blob
          ? decodeBase64(resource.blob)
          : undefined;
      if (!html) {
        throw new Error("The MCP App resource has no text or blob content.");
      }

      frame.removeAttribute("data-mcp-app-initialized");
      const sandboxReady = this.connectSandbox(
        frame,
        data,
        agent,
        controller.signal,
        version,
      );
      const proxyUrl = safeSandboxProxyURL(this.config.sandboxProxyUrl);
      if (proxyUrl) {
        frame.setAttribute("sandbox", "allow-scripts allow-forms");
        frame.removeAttribute("srcdoc");
        frame.src = proxyUrl;
      } else {
        frame.setAttribute(
          "sandbox",
          "allow-scripts allow-same-origin allow-forms",
        );
        frame.removeAttribute("src");
        frame.srcdoc = buildSandboxHTML();
      }

      await sandboxReady;
      this.throwIfStale(controller.signal, version);
      this.sendNotification(frame, "ui/notifications/sandbox-resource-ready", {
        html,
        resourceCsp: buildResourceCSP(resource._meta?.ui?.csp?.resourceDomains),
      });
      this.loading.set(false);
    } catch (error) {
      if (isCancellation(error)) return;
      this.fail(asError(error).message, frame, version);
    }
  }

  private connectSandbox(
    frame: HTMLIFrameElement,
    data: MCPAppsSnapshotContent,
    agent: AbstractAgent,
    abortSignal: AbortSignal,
    version: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out waiting ${this.config.initializationTimeoutMs}ms for the MCP App sandbox.`,
          ),
        );
      }, this.config.initializationTimeoutMs);
      const cancel = () => {
        cleanup();
        reject(new MCPAppsQueueCancelledError());
      };
      const onMessage = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow) return;
        const message = parseJSONRPCMessage(event.data);
        if (!message) return;

        if (message.method === "ui/notifications/sandbox-proxy-ready") {
          if (!ready) {
            ready = true;
            clearTimeout(timeout);
            resolve();
          }
          return;
        }

        void this.handleMessage(
          frame,
          data,
          agent,
          message,
          abortSignal,
          version,
        );
      };
      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        abortSignal.removeEventListener("abort", cancel);
      };

      window.addEventListener("message", onMessage);
      abortSignal.addEventListener("abort", cancel, { once: true });
      if (abortSignal.aborted) cancel();

      // Keep protocol messages connected after initialization. Cleanup occurs
      // when this render session's abort signal fires.
      abortSignal.addEventListener(
        "abort",
        () => window.removeEventListener("message", onMessage),
        { once: true },
      );
    });
  }

  private async handleMessage(
    frame: HTMLIFrameElement,
    data: MCPAppsSnapshotContent,
    agent: AbstractAgent,
    message: JSONRPCMessage,
    abortSignal: AbortSignal,
    version: number,
  ): Promise<void> {
    if (abortSignal.aborted || version !== this.renderVersion) return;

    if (message.id !== undefined) {
      switch (message.method) {
        case "ui/initialize":
          frame.setAttribute("data-mcp-app-initialized", "true");
          this.sendResponse(frame, message.id, {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: this.config.hostInfo,
            hostCapabilities: this.config.hostCapabilities,
            hostContext: this.config.hostContext,
          });
          return;
        case "ui/message":
          await this.handleUIMessage(frame, agent, message, version);
          return;
        case "ui/open-link":
          this.handleOpenLink(frame, message);
          return;
        case "tools/call":
          await this.handleToolCall(frame, data, agent, message, abortSignal);
          return;
        default:
          this.sendError(
            frame,
            message.id,
            -32601,
            `Method not found: ${message.method}`,
          );
          return;
      }
    }

    switch (message.method) {
      case "ui/notifications/initialized":
        if (data.toolInput) {
          this.sendNotification(frame, "ui/notifications/tool-input", {
            arguments: data.toolInput,
          });
        }
        this.sendNotification(
          frame,
          "ui/notifications/tool-result",
          data.result as Record<string, unknown>,
        );
        break;
      case "ui/notifications/size-changed": {
        const height = message.params?.height;
        if (
          typeof height === "number" &&
          Number.isFinite(height) &&
          height > 0
        ) {
          frame.style.height = `${Math.ceil(Math.min(height, 5000))}px`;
        }
        break;
      }
      case "notifications/message":
        console.info("[CopilotKit MCP App]", message.params ?? {});
        break;
    }
  }

  private async handleUIMessage(
    frame: HTMLIFrameElement,
    agent: AbstractAgent,
    message: JSONRPCMessage & { id?: string | number },
    version: number,
  ): Promise<void> {
    const id = message.id!;
    const role = message.params?.role === "assistant" ? "assistant" : "user";
    const content = Array.isArray(message.params?.content)
      ? message.params.content
          .filter(isTextContent)
          .map((part) => part.text)
          .join("\n")
      : "";

    if (content) {
      agent.addMessage({ id: randomUUID(), role, content });
    }
    this.sendResponse(frame, id, { isError: false });

    const shouldFollowUp =
      typeof message.params?.followUp === "boolean"
        ? message.params.followUp
        : role === "user";
    if (!shouldFollowUp || !content) return;

    try {
      await this.queue.enqueue({
        agent,
        ownerId: this.ownerId,
        dropAfterThreadSwitch: true,
        execute: () => this.copilotKit.core.runAgent({ agent }),
      });
    } catch (error) {
      if (isCancellation(error)) return;
      this.fail(
        `MCP App follow-up failed: ${asError(error).message}`,
        frame,
        version,
      );
    }
  }

  private handleOpenLink(
    frame: HTMLIFrameElement,
    message: JSONRPCMessage,
  ): void {
    const id = message.id!;
    const url = safeExternalURL(message.params?.url);
    if (!url) {
      this.sendError(frame, id, -32602, "A valid HTTP(S) URL is required.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    this.sendResponse(frame, id, { isError: false });
  }

  private async handleToolCall(
    frame: HTMLIFrameElement,
    data: MCPAppsSnapshotContent,
    agent: AbstractAgent,
    message: JSONRPCMessage,
    abortSignal: AbortSignal,
  ): Promise<void> {
    const id = message.id!;
    try {
      const runResult = await this.queue.enqueue({
        agent,
        ownerId: this.ownerId,
        execute: () =>
          agent.runAgent({
            forwardedProps: {
              __proxiedMCPRequest: {
                serverHash: data.serverHash,
                serverId: data.serverId,
                method: "tools/call",
                params: message.params,
              },
            },
          }),
      });
      if (!abortSignal.aborted)
        this.sendResponse(frame, id, runResult.result ?? {});
    } catch (error) {
      if (isCancellation(error)) return;
      this.sendError(frame, id, -32603, asError(error).message);
    }
  }

  private sendResponse(
    frame: HTMLIFrameElement,
    id: string | number,
    result: unknown,
  ): void {
    frame.contentWindow?.postMessage({ jsonrpc: "2.0", id, result }, "*");
  }

  private sendError(
    frame: HTMLIFrameElement,
    id: string | number,
    code: number,
    message: string,
  ): void {
    frame.contentWindow?.postMessage(
      { jsonrpc: "2.0", id, error: { code, message } },
      "*",
    );
  }

  private sendNotification(
    frame: HTMLIFrameElement,
    method: string,
    params: Record<string, unknown>,
  ): void {
    frame.contentWindow?.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  private fail(
    message: string,
    frame: HTMLIFrameElement,
    version: number,
  ): void {
    if (version !== this.renderVersion) return;
    this.loading.set(false);
    this.error.set(message);
    frame.removeAttribute("srcdoc");
    frame.removeAttribute("src");
    frame.removeAttribute("data-mcp-app-initialized");
  }

  private resetFrame(frame: HTMLIFrameElement): void {
    this.loading.set(true);
    this.error.set("");
    frame.style.removeProperty("height");
    frame.removeAttribute("srcdoc");
    frame.removeAttribute("src");
    frame.removeAttribute("data-mcp-app-initialized");
  }

  private throwIfStale(abortSignal: AbortSignal, version: number): void {
    if (abortSignal.aborted || version !== this.renderVersion) {
      throw new MCPAppsQueueCancelledError();
    }
  }
}

function queueForTimeout(idleTimeoutMs: number): MCPAppsRequestQueue {
  let queue = queuesByIdleTimeout.get(idleTimeoutMs);
  if (!queue) {
    queue = new MCPAppsRequestQueue({ idleTimeoutMs });
    queuesByIdleTimeout.set(idleTimeoutMs, queue);
  }
  return queue;
}

function findResource(
  runResult: RunAgentResult,
  resourceUri: string,
): FetchedResource {
  const result = runResult.result as
    | { contents?: FetchedResource[] }
    | undefined;
  const resource = result?.contents?.find(
    (candidate) => candidate.uri === resourceUri,
  );
  if (!resource) {
    throw new Error(
      `No matching MCP App resource was returned for "${resourceUri}".`,
    );
  }
  return resource;
}

function parseJSONRPCMessage(value: unknown): JSONRPCMessage | undefined {
  if (
    !isRecord(value) ||
    value.jsonrpc !== "2.0" ||
    typeof value.method !== "string"
  ) {
    return undefined;
  }
  if (
    value.id !== undefined &&
    typeof value.id !== "string" &&
    typeof value.id !== "number"
  ) {
    return undefined;
  }
  if (value.params !== undefined && !isRecord(value.params)) return undefined;
  return value as unknown as JSONRPCMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTextContent(
  value: unknown,
): value is { type: "text"; text: string } {
  return (
    isRecord(value) && value.type === "text" && typeof value.text === "string"
  );
}

function safeExternalURL(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function safeSandboxProxyURL(value: string): string | undefined {
  if (!value) return undefined;
  return safeExternalURL(value);
}

function decodeBase64(value: string): string {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    throw new Error("The MCP App resource contains invalid base64 content.");
  }
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof MCPAppsQueueCancelledError ||
    error instanceof MCPAppsQueueThreadChangedError
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Compares JSON-compatible activity snapshots without relying on object identity. */
function areStructurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areStructurallyEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        areStructurallyEqual(left[key], right[key]),
    )
  );
}

function buildResourceCSP(extraCspDomains?: string[]): string {
  const baseScriptSrc =
    "'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data: http://localhost:* https://localhost:*";
  const baseFrameSrc = "* blob: data: http://localhost:* https://localhost:*";
  const safeDomains = extraCspDomains?.filter(isSafeCSPDomain) ?? [];
  const extra = safeDomains.length ? ` ${safeDomains.join(" ")}` : "";

  return `default-src 'self'; img-src * data: blob: 'unsafe-inline'; media-src * blob: data:; font-src * blob: data:; script-src ${baseScriptSrc}${extra}; style-src * blob: data: 'unsafe-inline'; connect-src *; frame-src ${baseFrameSrc}${extra}; base-uri 'self';`;
}

function buildSandboxHTML(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden}*{box-sizing:border-box}iframe{background-color:transparent;border:none;padding:0;overflow:hidden;width:100%;height:100%}</style>
</head>
<body>
<script>
if(window.self===window.top){throw new Error("This file must be used in an iframe.")}
const inner=document.createElement("iframe");
inner.style="width:100%;height:100%;border:none;";
inner.setAttribute("sandbox","allow-scripts allow-same-origin allow-forms");
document.body.appendChild(inner);
function withResourceCsp(html,csp){
if(typeof csp!=="string"||!csp)return html;
const escaped=csp.replaceAll("&","&amp;").replaceAll('"',"&quot;");
const meta='<meta http-equiv="Content-Security-Policy" content="'+escaped+'" />';
const lower=html.toLowerCase();
const headStart=lower.indexOf("<head");
if(headStart>=0){const headEnd=html.indexOf(">",headStart);if(headEnd>=0)return html.slice(0,headEnd+1)+meta+html.slice(headEnd+1)}
const htmlStart=lower.indexOf("<html");
if(htmlStart>=0){const htmlEnd=html.indexOf(">",htmlStart);if(htmlEnd>=0)return html.slice(0,htmlEnd+1)+"<head>"+meta+"</head>"+html.slice(htmlEnd+1)}
return "<!doctype html><html><head>"+meta+"</head><body>"+html+"</body></html>";
}
window.addEventListener("message",(event)=>{
if(event.source===window.parent){
if(event.data&&event.data.method==="ui/notifications/sandbox-resource-ready"){
const{html,sandbox,resourceCsp}=event.data.params;
if(typeof sandbox==="string")inner.setAttribute("sandbox",sandbox);
if(typeof html==="string")inner.srcdoc=withResourceCsp(html,resourceCsp);
}else if(inner&&inner.contentWindow){inner.contentWindow.postMessage(event.data,"*")}
}else if(event.source===inner.contentWindow){window.parent.postMessage(event.data,"*")}
});
window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/sandbox-proxy-ready",params:{}},"*");
</script>
</body>
</html>`;
}

function isSafeCSPDomain(source: string): boolean {
  if (/[\s"'<>;]/u.test(source)) return false;

  try {
    const normalized = source.replace("://*.", "://wildcard.");
    const url = new URL(normalized);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
