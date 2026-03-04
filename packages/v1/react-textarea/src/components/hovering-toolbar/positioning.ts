export interface SelectionRect {
  top: number;
  left: number;
  bottom: number;
  width: number;
}

export interface ToolbarViewportPositionInput {
  rect: SelectionRect;
  toolbarWidth: number;
  toolbarHeight: number;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  viewportPadding: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function calculateToolbarViewportPosition(
  input: ToolbarViewportPositionInput,
): { top: number; left: number } {
  const {
    rect,
    toolbarWidth,
    toolbarHeight,
    scrollX,
    scrollY,
    viewportWidth,
    viewportHeight,
    viewportPadding,
  } = input;

  const minLeft = scrollX + viewportPadding;
  const maxLeft = scrollX + viewportWidth - toolbarWidth - viewportPadding;
  const centeredLeft = scrollX + rect.left + rect.width / 2 - toolbarWidth / 2;
  const left = clamp(centeredLeft, minLeft, maxLeft);

  // Prefer to render below selection, then flip above if there's no room.
  let top = scrollY + rect.bottom;
  const wouldOverflowBottom =
    rect.bottom + toolbarHeight + viewportPadding > viewportHeight;
  if (wouldOverflowBottom) {
    top = scrollY + rect.top - toolbarHeight;
  }

  const minTop = scrollY + viewportPadding;
  const maxTop = scrollY + viewportHeight - toolbarHeight - viewportPadding;
  top = clamp(top, minTop, maxTop);

  return { top, left };
}
