import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PersistedState } from "../../shared/persistence/inspector-state.js";
import { WindowController } from "./controller.js";

function createControllerFixture() {
  const element = document.createElement("div");
  const renderRoot = document.createElement("div");
  element.append(renderRoot);
  document.body.append(element);
  const operations: string[] = [];

  let controller: WindowController;
  controller = new WindowController({
    element,
    renderHost: element,
    getRenderRoot: () => renderRoot,
    getOwnerDocument: () => document,
    getUpdateComplete: () => Promise.resolve(),
    getStyles: () => [],
    renderWindow: () =>
      html`
        <section class="inspector-window"></section>
      `,
    requestUpdate: () => operations.push("requestUpdate"),
    persistState: () =>
      operations.push(`persist:${controller.isOpen ? "open" : "closed"}`),
    openInspector: () => operations.push("openInspector"),
    onLauncherReadyAfterClose: () => operations.push("launcherReady"),
    closeContextMenu: () => operations.push("closeContextMenu"),
    onGlobalPointerDown: () => undefined,
    isConnected: () => element.isConnected,
  });

  return { controller, element, renderRoot, operations };
}

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: PointerEventInit,
): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, ...init }),
  );
}

function installDragHandlers(
  controller: WindowController,
  target: HTMLElement,
): void {
  target.addEventListener("pointerdown", controller.handlePointerDown);
  target.addEventListener("pointermove", controller.handlePointerMove);
  target.addEventListener("pointerup", controller.handlePointerUp);
}

function installResizeHandlers(
  controller: WindowController,
  target: HTMLElement,
): void {
  target.addEventListener("pointerdown", controller.handleResizePointerDown);
  target.addEventListener("pointermove", controller.handleResizePointerMove);
  target.addEventListener("pointerup", controller.handleResizePointerUp);
}

afterEach(() => {
  document.body.replaceChildren();
  document.body.removeAttribute("style");
  document.documentElement.style.overflowX = "";
  vi.restoreAllMocks();
});

describe("WindowController", () => {
  it("hydrates valid placement and clamps a persisted docked size", () => {
    const { controller } = createControllerFixture();
    const persisted: PersistedState = {
      isOpen: true,
      dockMode: "docked-left",
      button: {
        anchor: { horizontal: "left", vertical: "bottom" },
        anchorOffset: { x: 24, y: 28 },
        hasCustomPosition: true,
      },
      window: {
        anchor: { horizontal: "right", vertical: "bottom" },
        anchorOffset: { x: 32, y: 36 },
        size: { width: 10_000, height: 10_000 },
        hasCustomPosition: true,
      },
    };

    controller.hydrateEarly(persisted);
    controller.hydrateGeometry(persisted);

    expect(controller.isOpen).toBe(true);
    expect(controller.dockMode).toBe("docked-left");
    expect(controller.contextState.button).toMatchObject({
      anchor: { horizontal: "left", vertical: "bottom" },
      anchorOffset: { x: 24, y: 28 },
    });
    expect(controller.contextState.window.size).toEqual({
      width: window.innerWidth - 32,
      height: window.innerHeight - 32,
    });
    expect(controller.hasCustomPosition).toEqual({
      button: true,
      window: true,
    });
  });

  it("preserves open and close callback order around persistence and updates", async () => {
    const { controller, operations } = createControllerFixture();

    controller.open({
      beforePersist: () => operations.push("beforePersist"),
      afterPersist: () => operations.push("afterPersist"),
    });

    expect(operations.slice(0, 3)).toEqual([
      "beforePersist",
      "persist:open",
      "afterPersist",
    ]);
    expect(operations.at(-1)).toBe("requestUpdate");
    await Promise.resolve();

    operations.length = 0;
    controller.close();
    expect(operations).toEqual(["persist:closed", "requestUpdate"]);

    await Promise.resolve();
    expect(operations).toEqual([
      "persist:closed",
      "requestUpdate",
      "persist:closed",
      "launcherReady",
    ]);
  });

  it("applies and removes dock host styles through the layout action", () => {
    const { controller, operations } = createControllerFixture();

    controller.handleDockClick("docked-left");

    expect(controller.dockMode).toBe("docked-left");
    expect(controller.contextState.window.size.width).toBe(720);
    expect(document.body.style.marginLeft).toBe("720px");
    expect(document.documentElement.style.overflowX).toBe("hidden");
    expect(operations).toContain("persist:closed");
    expect(operations).toContain("requestUpdate");

    controller.handleDockClick("floating");
    expect(controller.dockMode).toBe("floating");
    expect(document.body.style.marginLeft).toBe("0px");
    expect(document.documentElement.style.overflowX).toBe("");
  });

  it("snaps a dragged launcher to the nearest corner and persists it", () => {
    const { controller, element, renderRoot, operations } =
      createControllerFixture();
    const launcher = document.createElement("button");
    launcher.className = "console-button";
    launcher.dataset.dragContext = "button";
    launcher.getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: 16,
        y: 16,
        width: 48,
        height: 48,
      });
    renderRoot.append(launcher);
    installDragHandlers(controller, launcher);

    dispatchPointer(launcher, "pointerdown", {
      pointerId: 7,
      clientX: 20,
      clientY: 20,
    });
    dispatchPointer(launcher, "pointermove", {
      pointerId: 7,
      clientX: window.innerWidth - 20,
      clientY: window.innerHeight - 20,
    });
    dispatchPointer(launcher, "pointerup", {
      pointerId: 7,
      clientX: window.innerWidth - 20,
      clientY: window.innerHeight - 20,
    });

    expect(controller.contextState.button.anchor).toEqual({
      horizontal: "right",
      vertical: "bottom",
    });
    expect(controller.contextState.button.anchorOffset).toEqual({
      x: 16,
      y: 16,
    });
    expect(controller.hasCustomPosition.button).toBe(true);
    expect(element.style.transform).toBe(
      `translate3d(${window.innerWidth - 64}px, ${window.innerHeight - 64}px, 0)`,
    );
    expect(operations).toContain("persist:closed");
  });

  it("resizes a floating window from its west edge and persists on release", () => {
    const { controller, renderRoot, operations } = createControllerFixture();
    const inspectorWindow = document.createElement("section");
    inspectorWindow.className = "inspector-window";
    renderRoot.append(inspectorWindow);
    const handle = document.createElement("div");
    handle.dataset.resizeEdge = "w";
    renderRoot.append(handle);
    installResizeHandlers(controller, handle);
    controller.contextState.window.position = { x: 20, y: 20 };
    controller.contextState.window.size = { width: 960, height: 700 };

    dispatchPointer(handle, "pointerdown", {
      pointerId: 9,
      clientX: 20,
      clientY: 20,
    });
    dispatchPointer(handle, "pointermove", {
      pointerId: 9,
      clientX: 120,
      clientY: 20,
    });
    dispatchPointer(handle, "pointerup", {
      pointerId: 9,
      clientX: 120,
      clientY: 20,
    });

    expect(controller.contextState.window.size).toEqual({
      width: 880,
      height: 700,
    });
    expect(controller.hasCustomPosition.window).toBe(true);
    expect(
      operations.filter((operation) => operation === "persist:closed"),
    ).not.toHaveLength(0);
  });

  it("recognizes drag and resize targets created in another realm", () => {
    const { controller, renderRoot } = createControllerFixture();
    const frame = document.createElement("iframe");
    frame.title = "Foreign realm fixture";
    document.body.append(frame);
    const foreignDocument = frame.contentDocument;
    if (!foreignDocument) throw new Error("Expected an iframe document");

    const dragHandle = foreignDocument.createElement("div");
    dragHandle.dataset.dragContext = "window";
    const interactiveControl = foreignDocument.createElement("button");
    dragHandle.append(interactiveControl);
    installDragHandlers(controller, dragHandle);
    dispatchPointer(interactiveControl, "pointerdown", {
      pointerId: 11,
      clientX: 30,
      clientY: 30,
    });
    expect(controller.pointerContext).toBeNull();

    const inspectorWindow = document.createElement("section");
    inspectorWindow.className = "inspector-window";
    renderRoot.append(inspectorWindow);
    const resizeHandle = foreignDocument.createElement("div");
    resizeHandle.dataset.resizeEdge = "w";
    installResizeHandlers(controller, resizeHandle);
    controller.contextState.window.position = { x: 20, y: 20 };
    controller.contextState.window.size = { width: 960, height: 700 };

    dispatchPointer(resizeHandle, "pointerdown", {
      pointerId: 12,
      clientX: 20,
      clientY: 20,
    });
    dispatchPointer(resizeHandle, "pointermove", {
      pointerId: 12,
      clientX: 120,
      clientY: 20,
    });

    expect(controller.contextState.window.size.width).toBe(880);
  });

  it("resizes the floating window with arrow keys", () => {
    const { controller, operations } = createControllerFixture();
    controller.contextState.window.size = { width: 960, height: 700 };

    controller.handleResizeKeyDown(
      new KeyboardEvent("keydown", { key: "ArrowRight" }),
    );
    controller.handleResizeKeyDown(
      new KeyboardEvent("keydown", { key: "ArrowUp" }),
    );

    expect(controller.contextState.window.size).toEqual({
      width: 976,
      height: 684,
    });
    expect(controller.hasCustomPosition.window).toBe(true);
    expect(operations).toContain("persist:closed");
    expect(operations).toContain("requestUpdate");
  });

  it("uses the launcher minimum size before the launcher can be measured", () => {
    const { controller } = createControllerFixture();

    expect(controller.contextState.button.size).toEqual({
      width: 51.84,
      height: 51.84,
    });
  });
});
