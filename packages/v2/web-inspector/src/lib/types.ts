export type Position = { x: number; y: number };

export type Anchor = {
  horizontal: 'left' | 'right';
  vertical: 'top' | 'bottom';
};

export type Size = { width: number; height: number };

export type ContextKey = 'button' | 'window';

export type DockMode = 'floating' | 'docked-left';

export type ContextState = {
  position: Position;
  size: Size;
  anchor: Anchor;
  anchorOffset: Position;
};
