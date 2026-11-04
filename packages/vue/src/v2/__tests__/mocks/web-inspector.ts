import { vi } from "vitest";

export const WEB_INSPECTOR_TAG = "cpk-web-inspector";

export class WebInspectorElement extends HTMLElement {
  autoAttachCore = true;
  core: unknown = null;
  autoAttachCoreAtConnection = true;
  coreAtConnection: unknown = null;
  openInspector = vi.fn();

  connectedCallback() {
    this.autoAttachCoreAtConnection = this.autoAttachCore;
    this.coreAtConnection = this.core;
    // The real element reports that it is shown after its first render.
    this.dispatchEvent(
      new CustomEvent("cpk-inspector-visibility-change", {
        detail: { visible: true },
      }),
    );
  }
}

export const defineWebInspector = vi.fn(() => {
  if (!customElements.get(WEB_INSPECTOR_TAG)) {
    customElements.define(WEB_INSPECTOR_TAG, WebInspectorElement);
  }
});

export const configureWebInspectorElement = vi.fn(
  (
    inspector: HTMLElement & {
      autoAttachCore?: boolean;
      core?: unknown;
    },
    core: unknown,
  ) => {
    inspector.autoAttachCore = false;
    inspector.core = core;
    return inspector;
  },
);
