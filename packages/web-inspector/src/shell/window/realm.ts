import { nothing, render } from "lit";
import type { CSSResultOrNative, TemplateResult } from "lit";

import { defineWebInspector } from "../../register.js";
import {
  buildPopOutFeatures,
  ensureBrandFont,
  openPopOutWindow,
} from "./pop-out.js";
import type { PopOutHandle } from "./pop-out.js";

const POP_OUT_OVERLAY_STYLES = `
  html, body { margin: 0; height: 100%; background: #ffffff; }
  .inspector-window {
    position: fixed !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    border-radius: 0 !important;
  }
`;

export type WindowRealmHost = {
  renderHost: object;
  getRenderRoot: () => ParentNode;
  getOwnerDocument: () => Document;
  renderWindow: () => TemplateResult;
  requestUpdate: () => void;
  isConnected: () => boolean;
  isOpen: () => boolean;
  isDocked: () => boolean;
  removeDockStyles: () => void;
  applyDockStyles: () => void;
  onGlobalPointerDown: (event: PointerEvent) => void;
};

function hasEventView(
  event: Event | undefined,
): event is Event & { readonly view: Window | null } {
  return event !== undefined && "view" in event;
}

export class WindowRealmController {
  private popOut: PopOutHandle | null = null;
  private inspectorPortal: HTMLDivElement | null = null;

  constructor(private readonly host: WindowRealmHost) {}

  get isPoppedOut(): boolean {
    return this.popOut !== null && !this.popOut.win.closed;
  }

  get activeRoot(): ParentNode {
    return this.isPoppedOut
      ? (this.popOut?.win.document ?? this.host.getRenderRoot())
      : this.host.getRenderRoot();
  }

  get popOutViewportWidth(): number | undefined {
    return this.isPoppedOut ? this.popOut?.win.innerWidth : undefined;
  }

  ensureBrandFonts(doc: Document): void {
    ensureBrandFont(doc);
  }

  getClipboard(event?: Event): Clipboard | undefined {
    if (this.isPoppedOut) {
      const poppedClipboard = this.popOut?.win.navigator.clipboard;
      if (poppedClipboard) {
        return poppedClipboard;
      }
    }

    const eventClipboard = hasEventView(event)
      ? event.view?.navigator.clipboard
      : undefined;
    if (eventClipboard) {
      return eventClipboard;
    }

    return typeof navigator !== "undefined" && "clipboard" in navigator
      ? navigator.clipboard
      : undefined;
  }

  open(
    styles: readonly CSSResultOrNative[],
    size: { width: number; height: number },
  ): void {
    if (this.isPoppedOut) return;

    const sourceDocument = this.host.getOwnerDocument();
    const sourceWindow = sourceDocument.defaultView ?? window;
    const handle = openPopOutWindow({
      open: sourceWindow.open.bind(sourceWindow),
      features: buildPopOutFeatures(size),
      title: "CopilotKit Inspector",
      cssTexts: this.getPopOutCssTexts(styles),
      sourceDocument,
      onClose: () => this.handlePopOutClosed(),
    });
    this.popOut = handle;

    try {
      defineWebInspector(handle.win.customElements);
      if (this.host.isDocked()) {
        this.host.removeDockStyles();
      }
      handle.win.addEventListener("pointerdown", this.host.onGlobalPointerDown);
      this.syncPortal();
      this.host.requestUpdate();
    } catch (error) {
      this.popOut = null;
      this.unbindPointerDown(handle.win);
      handle.close();
      if (
        this.host.isConnected() &&
        this.host.isOpen() &&
        this.host.isDocked()
      ) {
        this.host.applyDockStyles();
      }
      this.host.requestUpdate();
      throw error;
    }
  }

  close(): void {
    const handle = this.popOut;
    if (!handle) return;
    this.handlePopOutClosed();
    handle.close();
  }

  syncPortal(): void {
    if (!this.inspectorPortal) {
      const portal = this.host.getOwnerDocument().createElement("div");
      portal.dataset.inspectorPortal = "true";
      portal.style.display = "contents";
      this.inspectorPortal = portal;
    }

    if (!this.host.isOpen()) {
      render(nothing, this.inspectorPortal, {
        host: this.host.renderHost,
        creationScope: this.host.getOwnerDocument(),
      });
      this.inspectorPortal.remove();
      return;
    }

    render(this.host.renderWindow(), this.inspectorPortal, {
      host: this.host.renderHost,
      creationScope: this.host.getOwnerDocument(),
    });

    const target = this.isPoppedOut
      ? this.popOut?.win.document.body
      : this.host
          .getRenderRoot()
          .querySelector<HTMLElement>("[data-inspector-portal-anchor]");
    if (target && this.inspectorPortal.parentNode !== target) {
      target.appendChild(this.inspectorPortal);
    }
  }

  private handlePopOutClosed(): void {
    const handle = this.popOut;
    if (!handle) return;
    this.popOut = null;
    this.unbindPointerDown(handle.win);
    this.syncPortal();
    if (this.host.isConnected() && this.host.isOpen() && this.host.isDocked()) {
      this.host.applyDockStyles();
    }
    this.host.requestUpdate();
  }

  private unbindPointerDown(win: Window): void {
    try {
      win.removeEventListener("pointerdown", this.host.onGlobalPointerDown);
    } catch {
      // The popup realm may already be gone.
    }
  }

  private getPopOutCssTexts(styles: readonly CSSResultOrNative[]): string[] {
    const fromStatic = styles.map((sheet) =>
      "cssText" in sheet ? String(sheet.cssText) : "",
    );
    return [...fromStatic.filter(Boolean), POP_OUT_OVERLAY_STYLES];
  }
}
