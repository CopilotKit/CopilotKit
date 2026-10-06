/* eslint-disable react-hooks/immutability -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type RefObject,
} from 'react';

import { classNames } from '../class-names';
import styles from './scroll-area.module.css';

/**
 * Mark a scroll container's hidden edges so shared CSS can show them.
 *
 * Writes `data-scroll-top` / `data-scroll-bottom` onto `target` (or the viewport
 * itself) whenever content is clipped above or below the viewport. Attributes
 * are written directly so scrolling never re-renders React. Content scrollers
 * (`data-scroll-fade`, ScrollArea) fade with a mask; sticky chrome such as a
 * table header or dialog footer reads the same attributes to lift.
 *
 * @param viewportRef - The element that owns `overflow: auto`.
 * @param targetRef - Optional ancestor that carries the edge attributes.
 */
export function useScrollEdges(
  viewportRef: RefObject<HTMLElement | null>,
  targetRef?: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const target = targetRef?.current ?? viewport;
    if (!viewport || !target) return;
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const top = viewport.scrollTop > 1;
      const bottom =
        viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;
      target.dataset.scrollTop = String(top);
      target.dataset.scrollBottom = String(bottom);
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener('scroll', schedule, { passive: true });
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule);
    resize?.observe(viewport);
    for (const child of Array.from(viewport.children)) resize?.observe(child);
    const mutations =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(schedule);
    mutations?.observe(viewport, { childList: true, subtree: true });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', schedule);
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, [targetRef, viewportRef]);
}

export interface ScrollAreaProps extends ComponentProps<'div'> {
  /** Class for the scrolling viewport; the outer element carries the edges. */
  readonly viewportClassName?: string;
}

/**
 * shadcn-style ScrollArea: a native-scrolling viewport whose content fades
 * (a mask, not a shadow) only while it continues past the top or bottom.
 */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea(
    { children, className, viewportClassName, ...viewportProps },
    forwardedRef,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    useScrollEdges(viewportRef, rootRef);
    const setViewport = useCallback(
      (node: HTMLDivElement | null) => {
        viewportRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    return (
      <div
        className={classNames(styles.root, className)}
        data-scroll-edges=""
        data-slot="scroll-area"
        ref={rootRef}
      >
        <div
          {...viewportProps}
          className={classNames(styles.viewport, viewportClassName)}
          data-slot="scroll-area-viewport"
          ref={setViewport}
        >
          {children}
        </div>
      </div>
    );
  },
);
