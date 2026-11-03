import { useLayoutEffect } from "react";
import type { RefObject } from "react";

/**
 * Mirror an AG Grid body's hidden scroll edges onto its card.
 *
 * AG Grid owns its scrolling viewport, so the card cannot use `ScrollArea`.
 * This writes `data-scroll-top` / `data-scroll-bottom` onto the card (which
 * carries `data-scroll-edges`) so the shared `@cpki/ui` mask fades the grid
 * body only while rows continue above or below the visible area.
 *
 * @param cardRef - The grid card that wraps `AgGridReact`.
 */
export function useGridScrollEdges(
  cardRef: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    let viewport: HTMLElement | null = null;
    let frame = 0;

    const update = (): void => {
      frame = 0;
      if (!viewport) {
        card.dataset.scrollTop = "false";
        card.dataset.scrollBottom = "false";
        return;
      }
      card.dataset.scrollTop = String(viewport.scrollTop > 1);
      card.dataset.scrollBottom = String(
        viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1,
      );
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    const attach = (): void => {
      const next =
        card.querySelector<HTMLElement>(".ag-body-vertical-scroll-viewport") ??
        card.querySelector<HTMLElement>(".ag-body-viewport");
      if (next !== viewport) {
        viewport?.removeEventListener("scroll", schedule);
        viewport = next;
        viewport?.addEventListener("scroll", schedule, { passive: true });
      }
      schedule();
    };

    attach();
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(attach);
    mutations?.observe(card, { childList: true, subtree: true });
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resize?.observe(card);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      viewport?.removeEventListener("scroll", schedule);
      mutations?.disconnect();
      resize?.disconnect();
    };
  }, [cardRef]);
}
