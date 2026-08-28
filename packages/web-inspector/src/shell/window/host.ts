import type { CSSResultOrNative, TemplateResult } from "lit";

export type WindowControllerHost = {
  element: HTMLElement;
  renderHost: object;
  getRenderRoot: () => ParentNode;
  getOwnerDocument: () => Document;
  getUpdateComplete: () => Promise<unknown>;
  getStyles: () => readonly CSSResultOrNative[];
  renderWindow: () => TemplateResult;
  requestUpdate: () => void;
  persistState: () => void;
  openInspector: () => void;
  onLauncherReadyAfterClose: () => void;
  closeContextMenu: () => void;
  onGlobalPointerDown: (event: PointerEvent) => void;
  isConnected: () => boolean;
};

export type ResizeEdge = "e" | "w" | "s" | "se" | "sw";

export function isElementEventTarget(
  target: EventTarget | null,
): target is EventTarget & Pick<Element, "closest"> {
  return target !== null && "closest" in target;
}

export function isDatasetEventTarget(
  target: EventTarget | null,
): target is EventTarget & { readonly dataset: DOMStringMap } {
  return target !== null && "dataset" in target;
}

export function isPointerCaptureTarget(
  target: EventTarget | null,
): target is EventTarget &
  Pick<
    Element,
    "setPointerCapture" | "hasPointerCapture" | "releasePointerCapture"
  > {
  return (
    target !== null &&
    "setPointerCapture" in target &&
    "hasPointerCapture" in target &&
    "releasePointerCapture" in target
  );
}

export function isResizeEdge(value: string | undefined): value is ResizeEdge {
  return (
    value === "w" ||
    value === "e" ||
    value === "s" ||
    value === "se" ||
    value === "sw"
  );
}
