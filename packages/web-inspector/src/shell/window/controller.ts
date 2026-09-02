import {
  isValidAnchor,
  isValidDockMode,
  isValidPosition,
  isValidSize,
} from "../../shared/persistence/inspector-state.js";
import type { PersistedState } from "../../shared/persistence/inspector-state.js";
import type {
  Anchor,
  ContextKey,
  ContextState,
  DockMode,
  Position,
  Size,
} from "../contracts.js";
import {
  DEFAULT_WINDOW_SIZE,
  EDGE_MARGIN,
  createContextState,
} from "../state.js";
import { LAUNCHER_MIN_SIZE } from "../styles/tokens.js";
import {
  applyAnchorPosition,
  centerContext,
  clampSize,
  constrainToViewport,
  keepPositionWithinViewport,
  updateAnchorFromPosition,
  updateSizeFromElement,
} from "./geometry.js";
import * as windowHost from "./host.js";
import { applyKeyboardResize } from "./keyboard-resize.js";
import { WindowRealmController } from "./realm.js";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_WIDTH_DOCKED_LEFT,
} from "./view.js";

const DRAG_THRESHOLD = 6;
const DOCKED_LEFT_WIDTH = 720;

export class WindowController {
  readonly contextState: Record<ContextKey, ContextState> =
    createContextState(LAUNCHER_MIN_SIZE);
  hasCustomPosition: Record<ContextKey, boolean> = {
    button: false,
    window: false,
  };
  isOpen = false;
  dockMode: DockMode = "floating";
  layoutMenuOpen = false;
  isDragging = false;
  pointerContext: ContextKey | null = null;

  private pointerId: number | null = null;
  private dragStart: Position | null = null;
  private dragOffset: Position = { x: 0, y: 0 };
  private draggedDuringInteraction = false;
  private ignoreNextButtonClick = false;
  private resizePointerId: number | null = null;
  private resizeStart: Position | null = null;
  private resizeInitialSize: Size | null = null;
  private resizeInitialPosition: Position | null = null;
  private resizeEdge: windowHost.ResizeEdge = "se";
  private isResizing = false;
  private previousBodyMargins: { left: string; bottom: string } | null = null;
  private previousHtmlOverflowX: string | null = null;
  private transitionTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly bodyTransitionTimeoutIds = new Set<
    ReturnType<typeof setTimeout>
  >();
  private readonly realm: WindowRealmController;

  constructor(private readonly host: windowHost.WindowControllerHost) {
    this.realm = new WindowRealmController({
      renderHost: host.renderHost,
      getRenderRoot: host.getRenderRoot,
      getOwnerDocument: host.getOwnerDocument,
      renderWindow: host.renderWindow,
      requestUpdate: host.requestUpdate,
      isConnected: host.isConnected,
      isOpen: () => this.isOpen,
      isDocked: () => this.dockMode !== "floating",
      removeDockStyles: () => this.removeDockStyles(),
      applyDockStyles: () => this.applyDockStyles(),
      onGlobalPointerDown: host.onGlobalPointerDown,
    });
  }

  get activeContext(): ContextKey {
    return this.isOpen ? "window" : "button";
  }

  get activeRoot(): ParentNode {
    return this.realm.activeRoot;
  }

  get isPoppedOut(): boolean {
    return this.realm.isPoppedOut;
  }

  get popOutViewportWidth(): number | undefined {
    return this.realm.popOutViewportWidth;
  }

  getClipboard(event?: Event): Clipboard | undefined {
    return this.realm.getClipboard(event);
  }

  ensureBrandFonts(): void {
    this.realm.ensureBrandFonts(this.host.getOwnerDocument());
  }

  hydrateEarly(persisted: PersistedState | null): void {
    if (!persisted) return;
    if (typeof persisted.isOpen === "boolean") {
      this.isOpen = persisted.isOpen;
    }
    if (isValidDockMode(persisted.dockMode)) {
      this.dockMode = persisted.dockMode;
    }
  }

  hydrateGeometry(persisted: PersistedState | null): void {
    if (!persisted) return;
    const persistedButton = persisted.button;
    if (persistedButton) {
      if (isValidAnchor(persistedButton.anchor)) {
        this.contextState.button.anchor = persistedButton.anchor;
      }
      if (isValidPosition(persistedButton.anchorOffset)) {
        this.contextState.button.anchorOffset = persistedButton.anchorOffset;
      }
      if (typeof persistedButton.hasCustomPosition === "boolean") {
        this.hasCustomPosition.button = persistedButton.hasCustomPosition;
      }
    }

    const persistedWindow = persisted.window;
    if (persistedWindow) {
      if (isValidAnchor(persistedWindow.anchor)) {
        this.contextState.window.anchor = persistedWindow.anchor;
      }
      if (isValidPosition(persistedWindow.anchorOffset)) {
        this.contextState.window.anchorOffset = persistedWindow.anchorOffset;
      }
      if (isValidSize(persistedWindow.size)) {
        this.contextState.window.size = this.clampWindowSize(
          persistedWindow.size,
        );
      }
      if (typeof persistedWindow.hasCustomPosition === "boolean") {
        this.hasCustomPosition.window = persistedWindow.hasCustomPosition;
      }
    }
  }

  measureInitialContexts(): void {
    this.measureContext("button");
    this.measureContext("window");
    this.contextState.button.anchor = { horizontal: "right", vertical: "top" };
    this.contextState.button.anchorOffset = { x: EDGE_MARGIN, y: EDGE_MARGIN };
    this.contextState.window.anchor = { horizontal: "right", vertical: "top" };
    this.contextState.window.anchorOffset = { x: EDGE_MARGIN, y: EDGE_MARGIN };
  }

  clampInitialWindowSize(): void {
    this.contextState.window.size = this.clampWindowSize(
      this.contextState.window.size,
    );
  }

  applyInitialPlacement(): void {
    if (this.isOpen && this.dockMode !== "floating") {
      this.applyDockStyles(true);
    }
    this.applyAnchorPosition("button");
    if (this.dockMode === "floating") {
      if (this.hasCustomPosition.window) {
        this.applyAnchorPosition("window");
      } else {
        this.centerContext("window");
      }
    }
  }

  updateInitialHostTransform(): void {
    this.updateHostTransform(this.isOpen ? "window" : "button");
  }

  syncDockAttribute(): void {
    if (this.isOpen && this.dockMode === "docked-left") {
      this.host.element.setAttribute("data-docked", "true");
    } else {
      this.host.element.removeAttribute("data-docked");
    }
  }

  syncPortal(): void {
    this.realm.syncPortal();
  }

  closePopOut(): void {
    this.realm.close();
  }

  clearTransitionTimers(): void {
    for (const id of this.bodyTransitionTimeoutIds) clearTimeout(id);
    this.bodyTransitionTimeoutIds.clear();
    if (this.transitionTimeoutId !== null) {
      clearTimeout(this.transitionTimeoutId);
      this.transitionTimeoutId = null;
    }
  }

  open(callbacks: {
    beforePersist: () => void;
    afterPersist: () => void;
  }): void {
    this.isOpen = true;
    callbacks.beforePersist();
    this.host.persistState();
    callbacks.afterPersist();
    if (this.dockMode !== "floating") {
      this.applyDockStyles();
    }
    this.ensureWindowPlacement();
    this.host.requestUpdate();
    void this.host.getUpdateComplete().then(() => {
      this.measureContext("window");
      if (this.dockMode === "floating") {
        if (this.hasCustomPosition.window) {
          this.applyAnchorPosition("window");
        } else {
          this.centerContext("window");
        }
      } else {
        this.updateHostTransform("window");
      }
    });
  }

  close(): void {
    if (this.isPoppedOut || !this.isOpen) return;
    this.isOpen = false;
    if (this.dockMode !== "floating") {
      this.removeDockStyles();
    }
    this.host.persistState();
    this.updateHostTransform("button");
    this.host.requestUpdate();
    void this.host.getUpdateComplete().then(() => {
      this.measureContext("button");
      this.applyAnchorPosition("button");
      this.host.onLauncherReadyAfterClose();
    });
  }

  requestPopOut = (): void => {
    if (this.isPoppedOut) return;
    this.layoutMenuOpen = false;
    this.host.requestUpdate();
    this.realm.open(
      this.host.getStyles(),
      this.getRenderedInspectorWindowSize(),
    );
  };

  handleLayoutMenuToggle = (event: Event): void => {
    event.stopPropagation();
    this.host.closeContextMenu();
    if (!this.layoutMenuOpen && this.dockMode === "floating") {
      this.contextState.window.size = this.getRenderedInspectorWindowSize();
    }
    this.layoutMenuOpen = !this.layoutMenuOpen;
    this.host.requestUpdate();
  };

  handleDockClick(mode: DockMode): void {
    this.layoutMenuOpen = false;
    this.setDockMode(mode);
  }

  handlePointerDown = (event: PointerEvent): void => {
    if (this.dockMode !== "floating" && this.isOpen) return;
    const target = event.currentTarget;
    const context: ContextKey =
      windowHost.isDatasetEventTarget(target) &&
      target.dataset.dragContext === "window"
        ? "window"
        : "button";
    if (
      context === "window" &&
      windowHost.isElementEventTarget(event.target) &&
      event.target.closest("button, a, nav")
    ) {
      return;
    }

    this.pointerContext = context;
    this.measureContext(context);
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.dragStart = { x: event.clientX, y: event.clientY };
    const state = this.contextState[context];
    this.dragOffset = {
      x: event.clientX - state.position.x,
      y: event.clientY - state.position.y,
    };
    this.isDragging = false;
    this.draggedDuringInteraction = false;
    this.ignoreNextButtonClick = false;
    if (windowHost.isPointerCaptureTarget(target))
      target.setPointerCapture?.(this.pointerId);
  };

  handlePointerMove = (event: PointerEvent): void => {
    if (
      this.pointerId !== event.pointerId ||
      !this.dragStart ||
      !this.pointerContext
    ) {
      return;
    }
    const distance = Math.hypot(
      event.clientX - this.dragStart.x,
      event.clientY - this.dragStart.y,
    );
    if (!this.isDragging && distance < DRAG_THRESHOLD) return;

    event.preventDefault();
    this.setDragging(true);
    this.draggedDuringInteraction = true;
    const state = this.contextState[this.pointerContext];
    state.position = this.constrainToViewport(
      {
        x: event.clientX - this.dragOffset.x,
        y: event.clientY - this.dragOffset.y,
      },
      this.pointerContext,
    );
    this.updateHostTransform(this.pointerContext);
  };

  handlePointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    this.releasePointerCapture(event, this.pointerId);
    const context = this.pointerContext ?? this.activeContext;
    if (this.isDragging && this.pointerContext) {
      event.preventDefault();
      this.setDragging(false);
      if (this.pointerContext === "window") {
        this.updateAnchorFromPosition(this.pointerContext);
        this.hasCustomPosition.window = true;
        this.applyAnchorPosition(this.pointerContext);
      } else {
        this.snapButtonToCorner();
        this.hasCustomPosition.button = true;
        if (this.draggedDuringInteraction) this.ignoreNextButtonClick = true;
      }
    } else if (
      context === "button" &&
      !this.isOpen &&
      !this.draggedDuringInteraction
    ) {
      this.host.openInspector();
    }
    this.resetPointerTracking();
  };

  handlePointerCancel = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    this.releasePointerCapture(event, this.pointerId);
    this.resetPointerTracking();
  };

  handleButtonClick = (event: Event): void => {
    if (this.isDragging) {
      event.preventDefault();
      return;
    }
    if (this.ignoreNextButtonClick) {
      event.preventDefault();
      this.ignoreNextButtonClick = false;
      return;
    }
    if (!this.isOpen) {
      event.preventDefault();
      this.host.openInspector();
    }
  };

  handleResizePointerDown = (event: PointerEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    this.hasCustomPosition.window = true;
    this.isResizing = true;
    this.resizePointerId = event.pointerId;
    this.resizeStart = { x: event.clientX, y: event.clientY };
    this.resizeInitialSize = { ...this.contextState.window.size };
    this.resizeInitialPosition = { ...this.contextState.window.position };
    const edge = windowHost.isDatasetEventTarget(event.currentTarget)
      ? event.currentTarget.dataset.resizeEdge
      : undefined;
    this.resizeEdge = windowHost.isResizeEdge(edge) ? edge : "se";
    const doc = this.host.getOwnerDocument();
    if (doc.body && this.dockMode !== "floating") {
      doc.body.style.transition = "";
    }
    if (windowHost.isPointerCaptureTarget(event.currentTarget)) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };

  handleResizeKeyDown = (event: KeyboardEvent): void => {
    const state = this.contextState.window;
    if (
      !applyKeyboardResize(event, {
        dockMode: this.dockMode,
        state,
        clampSize: (size) => this.clampWindowSize(size),
        document: this.host.getOwnerDocument(),
      })
    )
      return;
    this.hasCustomPosition.window = true;
    if (this.dockMode === "floating") {
      this.keepPositionWithinViewport("window");
      this.updateAnchorFromPosition("window");
      this.applyAnchorPosition("window");
    }
    this.host.persistState();
    this.host.requestUpdate();
  };

  handleResizePointerMove = (event: PointerEvent): void => {
    if (
      !this.isResizing ||
      this.resizePointerId !== event.pointerId ||
      !this.resizeStart ||
      !this.resizeInitialSize
    ) {
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - this.resizeStart.x;
    const deltaY = event.clientY - this.resizeStart.y;
    const state = this.contextState.window;
    const edge = this.resizeEdge;
    const growWest = edge === "w" || edge === "sw";
    const growEast =
      edge === "e" || edge === "se" || this.dockMode === "docked-left";
    const growSouth = edge === "s" || edge === "se" || edge === "sw";

    if (this.dockMode === "docked-left") {
      state.size = this.clampWindowSize({
        width: this.resizeInitialSize.width + deltaX,
        height: state.size.height,
      });
      this.host.getOwnerDocument().body.style.marginLeft = `${state.size.width}px`;
    } else {
      const initialSize = this.resizeInitialSize;
      const initialPosition = this.resizeInitialPosition ?? {
        ...state.position,
      };
      state.size = this.clampWindowSize({
        width: growEast
          ? initialSize.width + deltaX
          : growWest
            ? initialSize.width - deltaX
            : initialSize.width,
        height: growSouth ? initialSize.height + deltaY : initialSize.height,
      });
      if (growWest) {
        state.position = {
          x: initialPosition.x + initialSize.width - state.size.width,
          y: initialPosition.y,
        };
      }
      this.keepPositionWithinViewport("window");
      this.updateAnchorFromPosition("window");
    }
    this.host.requestUpdate();
    this.updateHostTransform("window");
  };

  handleResizePointerUp = (event: PointerEvent): void => {
    if (this.resizePointerId !== event.pointerId) return;
    this.finishResize(event);
  };

  handleResizePointerCancel = (event: PointerEvent): void => {
    if (this.resizePointerId !== event.pointerId) return;
    this.finishResize(event);
  };

  handleResize = (): void => {
    if (this.isPoppedOut) return;
    this.measureContext("button");
    this.applyAnchorPosition("button");
    this.measureContext("window");
    this.contextState.window.size = this.clampWindowSize(
      this.contextState.window.size,
    );
    if (this.hasCustomPosition.window) {
      this.applyAnchorPosition("window");
    } else {
      this.centerContext("window");
    }
    this.host.requestUpdate();
    this.updateHostTransform();
  };

  removeDockStyles(skipTransition = false): void {
    const doc = this.host.getOwnerDocument();
    if (!doc.body) return;
    if (!this.isResizing && !skipTransition) {
      doc.body.style.transition = "margin 300ms ease";
    }
    if (this.previousBodyMargins) {
      doc.body.style.marginLeft = this.previousBodyMargins.left;
      doc.body.style.marginBottom = this.previousBodyMargins.bottom;
      this.previousBodyMargins = null;
    } else {
      doc.body.style.marginLeft = "";
      doc.body.style.marginBottom = "";
    }
    if (this.previousHtmlOverflowX !== null) {
      doc.documentElement.style.overflowX = this.previousHtmlOverflowX;
      this.previousHtmlOverflowX = null;
    }
    if (!skipTransition) {
      this.scheduleBodyTransitionCleanup(doc);
    } else {
      doc.body.style.transition = "";
    }
  }

  private applyDockStyles(skipTransition = false): void {
    const doc = this.host.getOwnerDocument();
    if (!doc.body) return;
    const computedStyle = doc.defaultView?.getComputedStyle(doc.body);
    this.previousBodyMargins = {
      left: computedStyle?.marginLeft ?? "",
      bottom: computedStyle?.marginBottom ?? "",
    };
    if (!this.isResizing && !skipTransition) {
      doc.body.style.transition = "margin 300ms ease";
    }
    if (this.dockMode === "docked-left") {
      doc.body.style.marginLeft = `${this.contextState.window.size.width}px`;
      if (this.previousHtmlOverflowX === null) {
        this.previousHtmlOverflowX = doc.documentElement.style.overflowX;
      }
      doc.documentElement.style.overflowX = "hidden";
    }
    if (!this.isResizing && !skipTransition) {
      this.scheduleBodyTransitionCleanup(doc);
    }
  }

  private setDockMode(mode: DockMode): void {
    if (this.dockMode === mode) return;
    this.startHostTransition();
    this.removeDockStyles();
    this.dockMode = mode;
    if (mode !== "floating") {
      if (mode === "docked-left") {
        this.contextState.window.size.width = DOCKED_LEFT_WIDTH;
      }
      this.applyDockStyles();
    } else {
      this.contextState.window.size = this.clampWindowSize(DEFAULT_WINDOW_SIZE);
      this.centerContext("window");
    }
    this.host.persistState();
    this.host.requestUpdate();
    this.updateHostTransform("window");
  }

  private startHostTransition(duration = 300): void {
    this.host.element.setAttribute("data-transitioning", "true");
    if (this.transitionTimeoutId !== null)
      clearTimeout(this.transitionTimeoutId);
    this.transitionTimeoutId = setTimeout(() => {
      this.host.element.removeAttribute("data-transitioning");
      this.transitionTimeoutId = null;
    }, duration);
  }

  private scheduleBodyTransitionCleanup(doc: Document): void {
    const id = setTimeout(() => {
      this.bodyTransitionTimeoutIds.delete(id);
      if (doc.body) doc.body.style.transition = "";
    }, 300);
    this.bodyTransitionTimeoutIds.add(id);
  }

  private ensureWindowPlacement(): void {
    if (typeof window === "undefined") return;
    if (!this.hasCustomPosition.window) {
      this.centerContext("window");
      return;
    }
    const viewport = this.getViewportSize();
    keepPositionWithinViewport(this.contextState.window, viewport, EDGE_MARGIN);
    updateAnchorFromPosition(this.contextState.window, viewport, EDGE_MARGIN);
    this.updateHostTransform("window");
    this.host.persistState();
  }

  private measureContext(context: ContextKey): void {
    const selector =
      context === "window" ? ".inspector-window" : ".console-button";
    const element = this.host
      .getRenderRoot()
      .querySelector<HTMLElement>(selector);
    if (!element) return;
    updateSizeFromElement(
      this.contextState[context],
      element,
      context === "window"
        ? DEFAULT_WINDOW_SIZE
        : this.contextState.button.size,
    );
  }

  private centerContext(context: ContextKey): void {
    if (typeof window === "undefined") return;
    centerContext(
      this.contextState[context],
      this.getViewportSize(),
      EDGE_MARGIN,
    );
    if (context === this.activeContext) this.updateHostTransform(context);
    this.hasCustomPosition[context] = false;
    this.host.persistState();
  }

  private constrainToViewport(
    position: Position,
    context: ContextKey,
  ): Position {
    if (typeof window === "undefined") return position;
    return constrainToViewport(
      this.contextState[context],
      position,
      this.getViewportSize(),
      EDGE_MARGIN,
    );
  }

  private keepPositionWithinViewport(context: ContextKey): void {
    if (typeof window === "undefined") return;
    keepPositionWithinViewport(
      this.contextState[context],
      this.getViewportSize(),
      EDGE_MARGIN,
    );
  }

  private clampWindowSize(size: Size): Size {
    const minWidth =
      this.dockMode === "docked-left"
        ? MIN_WINDOW_WIDTH_DOCKED_LEFT
        : MIN_WINDOW_WIDTH;
    if (typeof window === "undefined") {
      return {
        width: Math.max(minWidth, size.width),
        height: Math.max(MIN_WINDOW_HEIGHT, size.height),
      };
    }
    return clampSize(
      size,
      this.getViewportSize(),
      EDGE_MARGIN,
      minWidth,
      MIN_WINDOW_HEIGHT,
    );
  }

  private updateHostTransform(context: ContextKey = this.activeContext): void {
    if (this.isPoppedOut || context !== this.activeContext) return;
    if (this.isOpen && this.dockMode === "docked-left") {
      this.host.element.setAttribute("data-docked", "true");
      this.host.element.style.transform = "none";
    } else {
      this.host.element.removeAttribute("data-docked");
      const { position } = this.contextState[context];
      this.host.element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }
  }

  private updateAnchorFromPosition(context: ContextKey): void {
    if (typeof window === "undefined") return;
    updateAnchorFromPosition(
      this.contextState[context],
      this.getViewportSize(),
      EDGE_MARGIN,
    );
  }

  private applyAnchorPosition(context: ContextKey): void {
    if (this.isPoppedOut || typeof window === "undefined") return;
    applyAnchorPosition(
      this.contextState[context],
      this.getViewportSize(),
      EDGE_MARGIN,
    );
    this.updateHostTransform(context);
    this.host.persistState();
  }

  private snapButtonToCorner(): void {
    if (typeof window === "undefined") return;
    const viewport = this.getViewportSize();
    const state = this.contextState.button;
    const centerX = state.position.x + state.size.width / 2;
    const centerY = state.position.y + state.size.height / 2;
    const horizontal: Anchor["horizontal"] =
      centerX < viewport.width / 2 ? "left" : "right";
    const vertical: Anchor["vertical"] =
      centerY < viewport.height / 2 ? "top" : "bottom";
    state.anchor = { horizontal, vertical };
    state.anchorOffset = { x: EDGE_MARGIN, y: EDGE_MARGIN };
    this.startHostTransition();
    this.applyAnchorPosition("button");
  }

  private finishResize(event: PointerEvent): void {
    this.releasePointerCapture(event, this.resizePointerId);
    if (this.dockMode === "floating") {
      this.updateAnchorFromPosition("window");
      this.applyAnchorPosition("window");
    }
    this.host.persistState();
    this.resetResizeTracking();
  }

  private releasePointerCapture(
    event: PointerEvent,
    pointerId: number | null,
  ): void {
    if (
      pointerId !== null &&
      windowHost.isPointerCaptureTarget(event.currentTarget) &&
      event.currentTarget.hasPointerCapture(pointerId)
    ) {
      event.currentTarget.releasePointerCapture(pointerId);
    }
  }

  private getRenderedInspectorWindowSize(): Size {
    const inspectorWindow = this.host
      .getRenderRoot()
      .querySelector<HTMLElement>(".inspector-window");
    if (inspectorWindow) {
      const width = Math.round(Number.parseFloat(inspectorWindow.style.width));
      const height = Math.round(
        Number.parseFloat(inspectorWindow.style.height),
      );
      if (Number.isFinite(width) && Number.isFinite(height)) {
        return { width, height };
      }
    }
    return this.clampWindowSize(this.contextState.window.size);
  }

  private getViewportSize(): Size {
    return typeof window === "undefined"
      ? { ...DEFAULT_WINDOW_SIZE }
      : { width: window.innerWidth, height: window.innerHeight };
  }

  private setDragging(value: boolean): void {
    if (this.isDragging === value) return;
    this.isDragging = value;
    this.host.requestUpdate();
  }

  private resetResizeTracking(): void {
    this.resizePointerId = null;
    this.resizeStart = null;
    this.resizeInitialSize = null;
    this.resizeInitialPosition = null;
    this.resizeEdge = "se";
    this.isResizing = false;
  }

  private resetPointerTracking(): void {
    this.pointerId = null;
    this.dragStart = null;
    this.pointerContext = null;
    this.setDragging(false);
    this.draggedDuringInteraction = false;
  }
}
