import { vi } from "vitest";
import type { Mock } from "vitest";

export const WEB_INSPECTOR_TAG = "cpk-web-inspector";

export class WebInspectorElement extends HTMLElement {
  autoAttachCore = true;
  intelligenceOnly = false;
  intelligenceAppUrl = "";
  policyAtCoreAttachment: {
    intelligenceOnly?: boolean;
    intelligenceAppUrl?: string;
  } | null = null;
  intelligenceOnlyAtConnection = false;
  core: unknown = null;
  autoAttachCoreAtConnection = true;
  coreAtConnection: unknown = null;
  openInspector: Mock<(source?: string, request?: unknown) => void> = vi.fn();

  connectedCallback() {
    this.autoAttachCoreAtConnection = this.autoAttachCore;
    this.intelligenceOnlyAtConnection = this.intelligenceOnly;
    this.coreAtConnection = this.core;
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
      intelligenceOnly?: boolean;
      intelligenceAppUrl?: string;
      policyAtCoreAttachment?: {
        intelligenceOnly?: boolean;
        intelligenceAppUrl?: string;
      } | null;
    },
    core: unknown,
  ) => {
    inspector.policyAtCoreAttachment = {
      intelligenceOnly: inspector.intelligenceOnly,
      intelligenceAppUrl: inspector.intelligenceAppUrl,
    };
    inspector.autoAttachCore = false;
    inspector.core = core;
    return inspector;
  },
);
