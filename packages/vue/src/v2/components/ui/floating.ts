import { onBeforeUnmount, ref, watch } from "vue";
import type { CSSProperties, Ref } from "vue";

/**
 * Positions floating UI (tooltips, popovers, menus) next to an element, the
 * way React's Radix primitives do: fixed to the viewport, flipped to the other
 * side when it does not fit, and shifted along its side to stay on screen.
 * Floating content sits in a wrapper that carries the position, so the
 * content's own enter and exit animations can use `transform`.
 * @internal
 */

export type FloatingSide = "top" | "right" | "bottom" | "left";
export type FloatingAlign = "start" | "center" | "end";

export interface FloatingOptions {
  side?: FloatingSide;
  align?: FloatingAlign;
  /** Distance from the reference element, in px. */
  sideOffset?: number;
  /** Shift along the side, in px, for `start` and `end`. */
  alignOffset?: number;
  /** Space kept between the content and the viewport edge, in px. */
  collisionPadding?: number;
  /** Size of an arrow drawn on the content, in px (added to the offset). */
  arrowSize?: number;
}

export interface FloatingPlacement {
  x: number;
  y: number;
  side: FloatingSide;
  align: FloatingAlign;
  /** Room left between the reference element and the viewport edge. */
  availableWidth: number;
  availableHeight: number;
  /** The reference element's center on the content, for its arrow. */
  arrowX?: number;
  arrowY?: number;
  transformOrigin: string;
}

const OPPOSITE: Record<FloatingSide, FloatingSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** Where content of `size` goes next to `reference` in a `viewport`. */
export function computeFloatingPlacement(
  reference: Pick<
    DOMRect,
    "top" | "left" | "right" | "bottom" | "width" | "height"
  >,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  options: FloatingOptions = {},
): FloatingPlacement {
  const {
    side: preferredSide = "bottom",
    align = "center",
    sideOffset = 0,
    alignOffset = 0,
    collisionPadding = 0,
    arrowSize = 0,
  } = options;
  const offset = sideOffset + arrowSize;

  const space = (side: FloatingSide) =>
    ({
      top: reference.top,
      bottom: viewport.height - reference.bottom,
      left: reference.left,
      right: viewport.width - reference.right,
    })[side] -
    offset -
    collisionPadding;
  const needed = (side: FloatingSide) =>
    side === "top" || side === "bottom" ? size.height : size.width;

  let side = preferredSide;
  const opposite = OPPOSITE[preferredSide];
  if (
    space(side) < needed(side) &&
    space(opposite) >= needed(opposite) &&
    space(opposite) > space(side)
  ) {
    side = opposite;
  }

  const vertical = side === "top" || side === "bottom";
  let x: number;
  let y: number;
  if (vertical) {
    y =
      side === "top"
        ? reference.top - size.height - offset
        : reference.bottom + offset;
    x =
      align === "start"
        ? reference.left + alignOffset
        : align === "end"
          ? reference.right - size.width - alignOffset
          : reference.left + reference.width / 2 - size.width / 2;
    x = clamp(
      x,
      collisionPadding,
      viewport.width - size.width - collisionPadding,
    );
  } else {
    x =
      side === "left"
        ? reference.left - size.width - offset
        : reference.right + offset;
    y =
      align === "start"
        ? reference.top + alignOffset
        : align === "end"
          ? reference.bottom - size.height - alignOffset
          : reference.top + reference.height / 2 - size.height / 2;
    y = clamp(
      y,
      collisionPadding,
      viewport.height - size.height - collisionPadding,
    );
  }

  const arrowX = vertical
    ? clamp(reference.left + reference.width / 2 - x, 0, size.width)
    : undefined;
  const arrowY = vertical
    ? undefined
    : clamp(reference.top + reference.height / 2 - y, 0, size.height);
  const transformOrigin = vertical
    ? `${arrowX}px ${side === "top" ? `${size.height + arrowSize}px` : `${-arrowSize}px`}`
    : `${side === "left" ? `${size.width + arrowSize}px` : `${-arrowSize}px`} ${arrowY}px`;

  return {
    x,
    y,
    side,
    align,
    availableWidth: vertical
      ? viewport.width - 2 * collisionPadding
      : Math.max(0, space(side)),
    availableHeight: vertical
      ? Math.max(0, space(side))
      : viewport.height - 2 * collisionPadding,
    arrowX,
    arrowY,
    transformOrigin,
  };
}

/** Whether `element` is scrolled or clipped fully out of view. */
export function isElementClippedAway(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  let top = 0;
  let left = 0;
  let bottom = view.innerHeight;
  let right = view.innerWidth;
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const { overflowX, overflowY } = view.getComputedStyle(parent);
    if (overflowX === "visible" && overflowY === "visible") continue;
    const clip = parent.getBoundingClientRect();
    top = Math.max(top, clip.top);
    left = Math.max(left, clip.left);
    bottom = Math.min(bottom, clip.bottom);
    right = Math.min(right, clip.right);
  }
  // Strict, so an element that only touches the edge still counts as shown.
  return (
    rect.bottom < top ||
    rect.top > bottom ||
    rect.right < left ||
    rect.left > right
  );
}

/**
 * Keeps `floating` placed next to `reference` while `open`: on scroll,
 * resize, and size changes of either element.
 */
export function useFloating(
  reference: Ref<HTMLElement | null | undefined>,
  floating: Ref<HTMLElement | null | undefined>,
  open: Ref<boolean>,
  options: () => FloatingOptions & { hideWhenDetached?: boolean },
) {
  const placement = ref<FloatingPlacement | null>(null);
  const referenceHidden = ref(false);
  let cleanup: (() => void) | undefined;

  const update = () => {
    const referenceElement = reference.value;
    const floatingElement = floating.value;
    if (!referenceElement || !floatingElement) return;
    const view = floatingElement.ownerDocument.defaultView;
    if (!view) return;
    const opts = options();
    placement.value = computeFloatingPlacement(
      referenceElement.getBoundingClientRect(),
      {
        width: floatingElement.offsetWidth,
        height: floatingElement.offsetHeight,
      },
      { width: view.innerWidth, height: view.innerHeight },
      opts,
    );
    referenceHidden.value =
      !!opts.hideWhenDetached &&
      (!referenceElement.isConnected || isElementClippedAway(referenceElement));
  };

  const stop = () => {
    cleanup?.();
    cleanup = undefined;
  };

  watch(
    [open, reference, floating],
    ([isOpen, referenceElement, floatingElement]) => {
      stop();
      if (!isOpen || !referenceElement || !floatingElement) {
        if (!isOpen) placement.value = null;
        return;
      }
      update();
      const view = floatingElement.ownerDocument.defaultView;
      if (!view) return;
      let frame = 0;
      const schedule = () => {
        if (frame) return;
        frame = view.requestAnimationFrame(() => {
          frame = 0;
          update();
        });
      };
      view.addEventListener("scroll", schedule, {
        capture: true,
        passive: true,
      });
      view.addEventListener("resize", schedule);
      const observer =
        typeof ResizeObserver === "undefined"
          ? undefined
          : new ResizeObserver(schedule);
      observer?.observe(referenceElement);
      observer?.observe(floatingElement);
      cleanup = () => {
        if (frame) view.cancelAnimationFrame(frame);
        view.removeEventListener("scroll", schedule, { capture: true });
        view.removeEventListener("resize", schedule);
        observer?.disconnect();
      };
    },
    { flush: "post", immediate: true },
  );

  onBeforeUnmount(stop);

  /** Style for the wrapper around the floating content. */
  const wrapperStyle = (zIndex?: string | number): CSSProperties => {
    const current = placement.value;
    return {
      position: "fixed",
      left: "0px",
      top: "0px",
      minWidth: "max-content",
      zIndex: zIndex ?? 50,
      // Off screen until measured, as Radix does.
      transform: current
        ? `translate(${Math.round(current.x)}px, ${Math.round(current.y)}px)`
        : "translate(0, -200%)",
      visibility: referenceHidden.value ? "hidden" : undefined,
      pointerEvents: referenceHidden.value ? "none" : undefined,
    };
  };

  return { placement, referenceHidden, update, wrapperStyle };
}

/**
 * Style for an arrow wrapper on floating content, as Radix places it: on the
 * edge facing the reference element, centered on it.
 */
export function arrowWrapperStyle(
  placement: FloatingPlacement | null,
): CSSProperties {
  if (!placement) return { position: "absolute", visibility: "hidden" };
  const { side, arrowX, arrowY } = placement;
  return {
    position: "absolute",
    left: arrowX !== undefined ? `${arrowX}px` : undefined,
    top: arrowY !== undefined ? `${arrowY}px` : undefined,
    [OPPOSITE[side]]: "0px",
    transformOrigin: {
      top: "",
      right: "0 0",
      bottom: "center 0",
      left: "100% 0",
    }[side],
    transform: {
      top: "translateY(100%)",
      right: "translateY(50%) rotate(90deg) translateX(-50%)",
      bottom: "rotate(180deg)",
      left: "translateY(50%) rotate(-90deg) translateX(50%)",
    }[side],
    marginLeft: arrowX !== undefined ? "-5px" : undefined,
  };
}
