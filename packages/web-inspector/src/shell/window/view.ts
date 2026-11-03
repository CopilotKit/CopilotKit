import { html, nothing } from "lit";
import type { TemplateResult } from "lit";

import type { DockMode, Size } from "../contracts.js";
import { DEFAULT_WINDOW_SIZE, EDGE_MARGIN } from "../state.js";

export const MIN_WINDOW_WIDTH = 880;
export const MIN_WINDOW_WIDTH_DOCKED_LEFT = 640;
export const MIN_WINDOW_HEIGHT = 480;
/**
 * The floating window zooms down with the screen, never below this, once the
 * viewport can no longer hold the default window at full size.
 */
const MIN_WINDOW_SCALE = 0.8;

/**
 * A window minimum that gives way on screens smaller than it, so the window
 * (and its close control) never runs past the viewport edge.
 */
export const viewportCappedMin = (px: number, unit: "vw" | "vh"): string =>
  `min(${px}px, calc(100${unit} - ${EDGE_MARGIN * 2}px))`;

/**
 * Zoom for the floating window: 1 while the viewport holds the default
 * window, then proportional to the screen down to MIN_WINDOW_SCALE, so a
 * small screen gets the same layout smaller rather than a cramped one.
 */
export function getWindowScale(
  isPoppedOut: boolean,
  dockMode: DockMode,
): number {
  if (typeof window === "undefined" || isPoppedOut || dockMode !== "floating") {
    return 1;
  }
  const fit = Math.min(
    window.innerWidth / (DEFAULT_WINDOW_SIZE.width + EDGE_MARGIN * 2),
    window.innerHeight / (DEFAULT_WINDOW_SIZE.height + EDGE_MARGIN * 2),
  );
  // Whole 5% steps, so a viewport a few pixels short of the default window
  // keeps the full-size window rather than a 0.99 zoom.
  return Math.min(1, Math.max(MIN_WINDOW_SCALE, Math.round(fit * 20) / 20));
}

/** Read the on-screen size of a rendered window whose layout box is zoomed. */
export function readRenderedWindowSize(
  inspectorWindow: HTMLElement,
  scale: number,
): Size | null {
  const width = Math.round(
    Number.parseFloat(inspectorWindow.style.width) * scale,
  );
  const height = Math.round(
    Number.parseFloat(inspectorWindow.style.height) * scale,
  );
  return Number.isFinite(width) && Number.isFinite(height)
    ? { width, height }
    : null;
}

export type WindowIconName =
  | "PanelLeft"
  | "Maximize2"
  | "PanelsTopLeft"
  | "PictureInPicture2";

type ResizeHandlers = {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
};

export function getDockedWindowStyles(
  dockMode: DockMode,
  size: { width: number; height: number },
): Record<string, string> {
  if (dockMode === "docked-left") {
    return {
      position: "fixed",
      top: "0",
      left: "0",
      bottom: "0",
      width: `${Math.round(size.width)}px`,
      height: "auto",
      minWidth: viewportCappedMin(MIN_WINDOW_WIDTH_DOCKED_LEFT, "vw"),
      borderRadius: "0",
    };
  }

  return {
    width: `${Math.round(size.width)}px`,
    height: `${Math.round(size.height)}px`,
    minWidth: viewportCappedMin(MIN_WINDOW_WIDTH, "vw"),
    minHeight: viewportCappedMin(MIN_WINDOW_HEIGHT, "vh"),
  };
}

export function renderDockResizeHandle(
  handlers: ResizeHandlers,
): TemplateResult {
  return html`
    <button
      class="dock-resize-handle pointer-events-auto"
      type="button"
      data-resize-edge="e"
      aria-label="Resize inspector width"
      title="Resize with Left and Right Arrow keys"
      @pointerdown=${handlers.onPointerDown}
      @pointermove=${handlers.onPointerMove}
      @pointerup=${handlers.onPointerUp}
      @pointercancel=${handlers.onPointerCancel}
      @keydown=${handlers.onKeyDown}
    ></button>
  `;
}

export function renderFloatingResizeHandles(
  isDocked: boolean,
  handlers: ResizeHandlers,
): TemplateResult {
  return html`
    ${
      isDocked
        ? nothing
        : html`
          <div
            class="edge-resize-handle edge-resize-handle-w pointer-events-auto"
            data-resize-edge="w"
            role="presentation"
            aria-hidden="true"
            @pointerdown=${handlers.onPointerDown}
            @pointermove=${handlers.onPointerMove}
            @pointerup=${handlers.onPointerUp}
            @pointercancel=${handlers.onPointerCancel}
          ></div>
          <div
            class="edge-resize-handle edge-resize-handle-e pointer-events-auto"
            data-resize-edge="e"
            role="presentation"
            aria-hidden="true"
            @pointerdown=${handlers.onPointerDown}
            @pointermove=${handlers.onPointerMove}
            @pointerup=${handlers.onPointerUp}
            @pointercancel=${handlers.onPointerCancel}
          ></div>
          <div
            class="edge-resize-handle edge-resize-handle-s pointer-events-auto"
            data-resize-edge="s"
            role="presentation"
            aria-hidden="true"
            @pointerdown=${handlers.onPointerDown}
            @pointermove=${handlers.onPointerMove}
            @pointerup=${handlers.onPointerUp}
            @pointercancel=${handlers.onPointerCancel}
          ></div>
        `
    }
    <button
      class="resize-handle pointer-events-auto absolute bottom-0 right-0 flex h-7 w-7 cursor-nwse-resize items-center justify-center text-gray-600 transition hover:text-gray-900"
      type="button"
      data-resize-edge="se"
      aria-label="Resize inspector"
      title="Resize with Arrow keys"
      @pointerdown=${handlers.onPointerDown}
      @pointermove=${handlers.onPointerMove}
      @pointerup=${handlers.onPointerUp}
      @pointercancel=${handlers.onPointerCancel}
      @keydown=${handlers.onKeyDown}
    >
      <svg
        class="h-3 w-3"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.5"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M5 15L15 5" />
        <path d="M9 15L15 9" />
      </svg>
    </button>
  `;
}

export function renderWindowLayoutMenu(options: {
  dockMode: DockMode;
  open: boolean;
  focusStyle: string;
  renderIcon: (name: WindowIconName) => unknown;
  onToggle: (event: Event) => void;
  onDock: (mode: DockMode) => void;
  onPopOut: () => void;
}): TemplateResult {
  const dockAction: {
    label: string;
    icon: WindowIconName;
    mode: DockMode;
  } =
    options.dockMode === "floating"
      ? {
          label: "Dock to left",
          icon: "PanelLeft",
          mode: "docked-left" as const,
        }
      : { label: "Float window", icon: "Maximize2", mode: "floating" as const };

  return html`
    <div
      class="inspector-window-layout"
      data-inspector-window-layout-root="true"
    >
      <button
        class="inspector-account-control inspector-window-layout-trigger flex h-8 w-8 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        type="button"
        aria-label="Window layout"
        aria-expanded=${options.open}
        aria-controls="cpk-inspector-layout-options"
        data-inspector-layout-trigger
        title="Window layout"
        style=${options.focusStyle}
        @click=${options.onToggle}
      >
        ${options.renderIcon("PanelsTopLeft")}
      </button>
      ${
        options.open
          ? html`
            <div
              id="cpk-inspector-layout-options"
              class="inspector-window-layout-menu"
            >
              <button
                type="button"
                aria-label=${dockAction.label}
                @click=${() => options.onDock(dockAction.mode)}
              >
                <span aria-hidden="true"
                  >${options.renderIcon(dockAction.icon)}</span
                >
                <span>${dockAction.label}</span>
              </button>
              <button
                type="button"
                aria-label="Detach Inspector into its own window"
                data-testid="cpk-inspector-pop-out"
                .click=${options.onPopOut}
                @click=${options.onPopOut}
              >
                <span aria-hidden="true"
                  >${options.renderIcon("PictureInPicture2")}</span
                >
                <span>Open in new window</span>
              </button>
            </div>
          `
          : nothing
      }
    </div>
  `;
}
