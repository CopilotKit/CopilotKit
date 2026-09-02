import type { ContextState, DockMode, Size } from "../contracts.js";

const KEYBOARD_RESIZE_STEP = 16;

export function applyKeyboardResize(
  event: KeyboardEvent,
  options: {
    dockMode: DockMode;
    state: ContextState;
    clampSize: (size: Size) => Size;
    document: Document;
  },
): boolean {
  const step = event.shiftKey ? KEYBOARD_RESIZE_STEP * 4 : KEYBOARD_RESIZE_STEP;
  const delta =
    event.key === "ArrowLeft"
      ? { width: -step, height: 0 }
      : event.key === "ArrowRight"
        ? { width: step, height: 0 }
        : event.key === "ArrowUp"
          ? { width: 0, height: -step }
          : event.key === "ArrowDown"
            ? { width: 0, height: step }
            : null;
  if (
    delta === null ||
    (options.dockMode !== "floating" && delta.width === 0)
  ) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  options.state.size = options.clampSize({
    width: options.state.size.width + delta.width,
    height: options.state.size.height + delta.height,
  });
  if (options.dockMode !== "floating") {
    options.document.body.style.marginLeft = `${options.state.size.width}px`;
  }
  return true;
}
