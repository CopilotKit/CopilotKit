import type { Anchor, ContextState, Position, Size } from './types';

export function updateSizeFromElement(
  state: ContextState,
  element: HTMLElement,
  fallback: Size,
): void {
  const rect = element.getBoundingClientRect();
  state.size = {
    width: rect.width || fallback.width,
    height: rect.height || fallback.height,
  };
}

export function clampSize(
  size: Size,
  viewport: Size,
  edgeMargin: number,
  minWidth: number,
  minHeight: number,
): Size {
  const maxWidth = Math.max(minWidth, viewport.width - edgeMargin * 2);
  const maxHeight = Math.max(minHeight, viewport.height - edgeMargin * 2);

  return {
    width: clamp(size.width, minWidth, maxWidth),
    height: clamp(size.height, minHeight, maxHeight),
  };
}

export function constrainToViewport(
  state: ContextState,
  position: Position,
  viewport: Size,
  edgeMargin: number,
): Position {
  const maxX = Math.max(edgeMargin, viewport.width - state.size.width - edgeMargin);
  const maxY = Math.max(edgeMargin, viewport.height - state.size.height - edgeMargin);

  return {
    x: clamp(position.x, edgeMargin, maxX),
    y: clamp(position.y, edgeMargin, maxY),
  };
}

export function keepPositionWithinViewport(
  state: ContextState,
  viewport: Size,
  edgeMargin: number,
): void {
  state.position = constrainToViewport(state, state.position, viewport, edgeMargin);
}

export function centerContext(
  state: ContextState,
  viewport: Size,
  edgeMargin: number,
): Position {
  const centered: Position = {
    x: Math.round((viewport.width - state.size.width) / 2),
    y: Math.round((viewport.height - state.size.height) / 2),
  };

  state.position = constrainToViewport(state, centered, viewport, edgeMargin);
  updateAnchorFromPosition(state, viewport, edgeMargin);
  return state.position;
}

export function updateAnchorFromPosition(
  state: ContextState,
  viewport: Size,
  edgeMargin: number,
): void {
  const centerX = state.position.x + state.size.width / 2;
  const centerY = state.position.y + state.size.height / 2;

  const horizontal: Anchor['horizontal'] = centerX < viewport.width / 2 ? 'left' : 'right';
  const vertical: Anchor['vertical'] = centerY < viewport.height / 2 ? 'top' : 'bottom';

  state.anchor = { horizontal, vertical };

  const maxHorizontalOffset = Math.max(edgeMargin, viewport.width - state.size.width - edgeMargin);
  const maxVerticalOffset = Math.max(edgeMargin, viewport.height - state.size.height - edgeMargin);

  state.anchorOffset = {
    x:
      horizontal === 'left'
        ? clamp(state.position.x, edgeMargin, maxHorizontalOffset)
        : clamp(viewport.width - state.position.x - state.size.width, edgeMargin, maxHorizontalOffset),
    y:
      vertical === 'top'
        ? clamp(state.position.y, edgeMargin, maxVerticalOffset)
        : clamp(viewport.height - state.position.y - state.size.height, edgeMargin, maxVerticalOffset),
  };
}

export function applyAnchorPosition(
  state: ContextState,
  viewport: Size,
  edgeMargin: number,
): Position {
  const maxHorizontalOffset = Math.max(edgeMargin, viewport.width - state.size.width - edgeMargin);
  const maxVerticalOffset = Math.max(edgeMargin, viewport.height - state.size.height - edgeMargin);

  const horizontalOffset = clamp(state.anchorOffset.x, edgeMargin, maxHorizontalOffset);
  const verticalOffset = clamp(state.anchorOffset.y, edgeMargin, maxVerticalOffset);

  const x =
    state.anchor.horizontal === 'left'
      ? horizontalOffset
      : viewport.width - state.size.width - horizontalOffset;

  const y =
    state.anchor.vertical === 'top'
      ? verticalOffset
      : viewport.height - state.size.height - verticalOffset;

  state.anchorOffset = { x: horizontalOffset, y: verticalOffset };
  state.position = constrainToViewport(state, { x, y }, viewport, edgeMargin);
  return state.position;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), max);
}
