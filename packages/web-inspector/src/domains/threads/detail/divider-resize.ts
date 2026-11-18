const MIN_DETAIL_PANEL_WIDTH = 160;
const MAX_DETAIL_PANEL_WIDTH = 400;

/** Drags the detail-panel divider and reports each new panel width. */
export class DividerResize {
  private resizing = false;
  private pointerId = -1;
  private startX = 0;
  private startWidth = 0;

  constructor(
    private readonly getWidth: () => number,
    private readonly setWidth: (width: number) => void,
  ) {}

  readonly down = (event: PointerEvent): void => {
    this.resizing = true;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startWidth = this.getWidth();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  readonly move = (event: PointerEvent): void => {
    if (!this.resizing || this.pointerId !== event.pointerId) return;
    // The panel sits on the right, so dragging left widens it.
    const delta = this.startX - event.clientX;
    this.setWidth(
      Math.max(
        MIN_DETAIL_PANEL_WIDTH,
        Math.min(MAX_DETAIL_PANEL_WIDTH, this.startWidth + delta),
      ),
    );
  };

  readonly up = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(this.pointerId)) {
      target.releasePointerCapture(this.pointerId);
    }
    this.resizing = false;
  };
}
