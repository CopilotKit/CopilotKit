import { LitElement, html, css } from "lit";
import type { CopilotKitCore } from "@copilotkit/core";
import { attachIntelligenceRelay } from "../lib/intelligence-relay.js";
import { fetchInspectorIntelligence } from "../lib/intelligence-transport.js";

/** Loads only the selected product view inside the existing Inspector content pane. */
export class InspectorIntelligenceView extends LitElement {
  static properties = {
    core: { attribute: false },
    appUrl: { attribute: false },
    section: { type: String },
    agentId: { attribute: false },
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
  `;
  core: CopilotKitCore | null = null;
  appUrl = "";
  section: "analytics" | "governance" | "learning" = "analytics";
  agentId = "";
  private denied = false;
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
      if (this.agentId) url.searchParams.set("agentId", this.agentId);
      return url;
    } catch {
      return null;
    }
  }

  /** Attaches the authenticated relay after the iframe exists. */
  protected updated(): void {
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
      onAccessLost: () => {
        this.denied = true;
      },
    });
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
      ? html`<iframe title=${`${this.section.charAt(0).toUpperCase()}${this.section.slice(1)}`} src=${url.href} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerpolicy="no-referrer"></iframe>`
      : html`
          <p role="status">Intelligence is unavailable.</p>
        `;
  }
}

if (!customElements.get("cpk-intelligence-view"))
  customElements.define("cpk-intelligence-view", InspectorIntelligenceView);
