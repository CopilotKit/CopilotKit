import { html, LitElement, nothing } from "lit";
import type { AbstractAgent } from "@ag-ui/client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { bindMcpApp } from "../session";
import type { FetchedResource, McpAppSession } from "../session";
import type { ɵMcpFollowUpHost } from "../follow-up";
import type { MCPAppsActivityContent } from "../content-schema";

/**
 * `<copilotkit-mcp-app>` - framework-agnostic host element for a single MCP App.
 *
 * The element OWNS the sandbox iframe: it creates the iframe exactly once (in a
 * static slot, imperatively, NOT through the reactive template) so re-renders,
 * property updates, and reactive state changes never remount it. All protocol
 * logic lives in `bindMcpApp`; this element only mounts the iframe, sizes it
 * from the widget's size notifications, forwards tool input/result on content
 * changes, and surfaces lifecycle as DOM events:
 *
 *   - `copilotkit-mcp-initialized`  the widget finished initializing
 *   - `copilotkit-mcp-size-changed` detail: { width?, height? }
 *   - `copilotkit-mcp-error`        detail: { error: Error }
 *
 * Consumers (React/Vue/Angular thin adapters, or plain HTML) set the `agent`,
 * `host`, and `content` properties (all objects, so `attribute: false`); the
 * session binds as soon as `agent` + `content` + `host` are all present.
 */
export class CopilotKitMcpApp extends LitElement {
  static properties = {
    agent: { attribute: false },
    host: { attribute: false },
    content: { attribute: false },
  };

  /** The AG-UI agent used to proxy resource/tool requests. */
  agent?: AbstractAgent;
  /** CopilotKit host, for ui/message follow-up runs (issue #5819). */
  host?: ɵMcpFollowUpHost;
  /** The activity content (resourceUri, serverHash, tool input/result). */
  content?: MCPAppsActivityContent;

  private iframe: HTMLIFrameElement | null = null;
  private session: McpAppSession | null = null;
  private started = false;
  private lastToolInput?: string;
  private lastToolResult?: string;
  private setupError: Error | null = null;

  /** Light DOM: the iframe lives in the page, easy to size, no shadow needed. */
  protected createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // If the element was moved (disconnect -> reconnect) the iframe still exists
    // but the session was torn down; rebind against the current props.
    if (this.iframe && !this.session) {
      this.maybeStart();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.session?.teardown();
    this.session = null;
    this.started = false;
  }

  protected firstUpdated(): void {
    // Create the iframe ONCE, imperatively, into the static slot. It is never
    // part of the reactive template, so Lit never reconciles/remounts it.
    const slot = this.querySelector<HTMLElement>("[data-mcp-slot]");
    if (!slot) return;
    const iframe = document.createElement("iframe");
    iframe.style.width = "100%";
    iframe.style.border = "none";
    slot.appendChild(iframe);
    this.iframe = iframe;
    this.maybeStart();
  }

  protected updated(changed: Map<string, unknown>): void {
    if (!this.started) {
      // Deps may have arrived after firstUpdated (frameworks often set
      // properties over several ticks).
      if (
        changed.has("agent") ||
        changed.has("host") ||
        changed.has("content")
      ) {
        this.maybeStart();
      }
      return;
    }
    if (changed.has("content")) {
      this.pushContent();
    }
  }

  private maybeStart(): void {
    if (this.started || !this.iframe) return;
    const { agent, host, content } = this;
    if (!agent || !host || !content) return;

    this.started = true;
    this.setupError = null;
    this.session = bindMcpApp({
      iframe: this.iframe,
      getContent: () => this.content as MCPAppsActivityContent,
      getAgent: () => this.agent,
      host,
      hooks: {
        onSizeChanged: (size) => this.onSizeChanged(size),
        onInitialized: () => this.onInitialized(),
        onResource: (resource) => this.onResource(resource),
        onError: (error) => this.onSetupError(error),
      },
    });
    // Push any tool input/result already present (buffered until the widget is
    // ready by the session itself).
    this.pushContent();
  }

  /** Forward tool input/result to the widget when they change (Effects 3/4). */
  private pushContent(): void {
    if (!this.session || !this.content) return;
    const { toolInput, result } = this.content;

    if (toolInput !== undefined) {
      const key = safeStringify(toolInput);
      if (key !== this.lastToolInput) {
        this.lastToolInput = key;
        this.session.sendToolInput(toolInput as Record<string, unknown>);
      }
    }
    if (result !== undefined) {
      const key = safeStringify(result);
      if (key !== this.lastToolResult) {
        this.lastToolResult = key;
        this.session.sendToolResult(result as CallToolResult);
      }
    }
  }

  private onSizeChanged(size: { width?: number; height?: number }): void {
    if (this.iframe && typeof size.height === "number") {
      this.iframe.style.height = `${size.height}px`;
    }
    this.dispatchEvent(
      new CustomEvent("copilotkit-mcp-size-changed", {
        detail: size,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onInitialized(): void {
    this.dispatchEvent(
      new CustomEvent("copilotkit-mcp-initialized", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onResource(resource: FetchedResource): void {
    // Reflect the widget's border preference so consumers can style the host.
    if (resource._meta?.ui?.prefersBorder) {
      this.setAttribute("prefers-border", "");
    } else {
      this.removeAttribute("prefers-border");
    }
  }

  private onSetupError(error: Error): void {
    this.setupError = error;
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent("copilotkit-mcp-error", {
        detail: { error },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      ${
        this.setupError
          ? html`<div data-mcp-error role="alert">
            ${this.setupError.message}
          </div>`
          : nothing
      }
      <div data-mcp-slot></div>
    `;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "copilotkit-mcp-app": CopilotKitMcpApp;
  }
}
