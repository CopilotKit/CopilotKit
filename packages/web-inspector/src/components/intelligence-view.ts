import { LitElement, html, css } from "lit";
import type { PropertyValues } from "lit";
import type { CopilotKitCore } from "@copilotkit/core";
import {
  attachIntelligenceRelay,
  isInspectorChannelScope,
  parseTimeWindow,
} from "../lib/intelligence-relay.js";
import type {
  InspectorChannelScope,
  InspectorTimeWindow,
} from "../lib/intelligence-relay.js";
import { fetchInspectorIntelligence } from "../lib/intelligence-transport.js";

/** Loads only the selected product view inside the existing Inspector content pane. */
export class InspectorIntelligenceView extends LitElement {
  static properties = {
    core: { attribute: false },
    appUrl: { attribute: false },
    section: { type: String },
    agentId: { attribute: false },
    colorScheme: { attribute: "color-scheme", reflect: true },
    denied: { state: true },
  };
  static styles = css`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
      background: #fff;
    }
    iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
    }
    p {
      margin: 20px;
      color: #676570;
      font: 13px/1.5 inherit;
    }
    :host([color-scheme="dark"]) {
      background: #111319;
    }
    :host([color-scheme="dark"]) p {
      color: #b8bbc7;
    }
  `;
  core: CopilotKitCore | null = null;
  appUrl = "";
  section: "analytics" | "governance" | "learning" = "analytics";
  agentId = "";
  colorScheme: "light" | "dark" = "light";
  // This input is read only when the host opens a new section.
  timeWindow: InspectorTimeWindow | undefined;
  channel: InspectorChannelScope = "";
  private navigationChannel: InspectorChannelScope = "";
  private navigationKey = "";
  private navigationTime: InspectorTimeWindow | undefined;
  private navigationColorScheme: "light" | "dark" = "light";
  private navigationAgentId = "";
  private scopeMessagingReady = false;
  private denied = false;

  /** Applies the saved window on navigation without reloading the current iframe. */
  protected willUpdate(): void {
    const key = JSON.stringify([this.appUrl, this.section]);
    if (key !== this.navigationKey) {
      this.scopeMessagingReady = false;
      this.navigationKey = key;
      this.navigationChannel = isInspectorChannelScope(this.channel)
        ? this.channel
        : "";
      this.navigationTime = parseTimeWindow(this.timeWindow) ?? undefined;
      this.navigationColorScheme = this.colorScheme;
      this.navigationAgentId = this.agentId;
    } else if (!this.scopeMessagingReady) {
      // An older embedded app still needs navigation to receive a new scope.
      this.navigationAgentId = this.agentId;
    }
  }
  private disposeRelay: (() => void) | undefined;

  /** Keeps every navigation credential-free and scoped to the host's selected agent. */
  private frameUrl(): URL | null {
    try {
      const url = new URL(this.appUrl);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          ))
      )
        return null;
      url.searchParams.set(
        "parentOrigin",
        this.ownerDocument.defaultView!.location.origin,
      );
      url.searchParams.set("section", this.section);
      url.searchParams.set("colorScheme", this.navigationColorScheme);
      if (this.navigationAgentId)
        url.searchParams.set("agentId", this.navigationAgentId);
      if (this.navigationChannel)
        url.searchParams.set("channel", this.navigationChannel);
      if (this.navigationTime) {
        url.searchParams.set("from", this.navigationTime.from);
        url.searchParams.set("to", this.navigationTime.to);
        if (this.navigationTime.period)
          url.searchParams.set("period", this.navigationTime.period);
      }
      return url;
    } catch {
      return null;
    }
  }

  /** Attaches the authenticated relay after the iframe exists. */
  protected updated(changed: PropertyValues): void {
    this.syncColorScheme();
    if (
      this.disposeRelay &&
      !["core", "appUrl", "section", "agentId", "denied"].some((key) =>
        changed.has(key),
      )
    )
      return;
    this.disposeRelay?.();
    this.disposeRelay = undefined;
    const frame = this.shadowRoot?.querySelector("iframe");
    const core = this.core;
    const runtimeUrl = core?.runtimeUrl;
    const url = this.frameUrl();
    const target = this.ownerDocument.defaultView;
    if (!frame || !core || !runtimeUrl || !url || !target) return;
    this.disposeRelay = attachIntelligenceRelay({
      target,
      frame,
      origin: url.origin,
      onThemeRequest: () => this.syncColorScheme(),
      onScopeRequest: () => {
        this.scopeMessagingReady = true;
        this.syncAgentScope();
      },
      request: (request, signal) =>
        fetchInspectorIntelligence(
          {
            runtimeUrl,
            runtimeTransport: core.runtimeTransport,
            fetch: core.ɵruntimeFetch,
            headers: core.headers,
            credentials: core.credentials,
          },
          request,
          signal,
        ),
      onChannelScope: (channel) =>
        this.dispatchEvent(
          new CustomEvent("intelligence-channel-scope", {
            detail: channel,
            bubbles: true,
            composed: true,
          }),
        ),
      onTimeWindow: (timeWindow) =>
        this.dispatchEvent(
          new CustomEvent("intelligence-time-window", {
            detail: timeWindow,
            bubbles: true,
            composed: true,
          }),
        ),
      onAccessLost: () => {
        this.denied = true;
        this.dispatchEvent(
          new CustomEvent("intelligence-access-lost", {
            bubbles: true,
            composed: true,
          }),
        );
      },
    });
    this.syncAgentScope();
  }

  /** Changes scope in the mounted app after old authenticated reads are cancelled. */
  private syncAgentScope(): void {
    const frame = this.shadowRoot?.querySelector("iframe");
    const url = this.frameUrl();
    if (!frame || !url) return;
    frame.contentWindow?.postMessage(
      { type: "cpki:agent-scope", version: 1, agentId: this.agentId },
      url.origin,
    );
  }

  /** Updates appearance without replacing the document or aborting pending reads. */
  private syncColorScheme(): void {
    const frame = this.shadowRoot?.querySelector("iframe");
    const url = this.frameUrl();
    if (!frame || !url) return;
    frame.contentWindow?.postMessage(
      {
        type: "cpki:color-scheme",
        version: 1,
        colorScheme: this.colorScheme,
      },
      url.origin,
    );
  }

  /** Cancels pending reads when an existing Inspector tab replaces this view. */
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.disposeRelay?.();
    this.disposeRelay = undefined;
  }

  render() {
    if (this.denied)
      return html`
        <p role="alert">Access unavailable. Reopen this view to retry.</p>
      `;
    const url = this.frameUrl();
    return url && this.core?.runtimeUrl
      ? html`<iframe title=${`${this.section.charAt(0).toUpperCase()}${this.section.slice(1)}`} src=${url.href} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" allow="clipboard-write 'src'" referrerpolicy="no-referrer"></iframe>`
      : html`
          <p role="status">Intelligence is unavailable.</p>
        `;
  }
}

if (!customElements.get("cpk-intelligence-view"))
  customElements.define("cpk-intelligence-view", InspectorIntelligenceView);
