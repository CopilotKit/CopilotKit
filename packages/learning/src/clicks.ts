import type { ClickTarget, Emit, EnrichFn } from "./types";

const INTERACTIVE =
  "button, a[href], input, select, textarea, label, summary, [role], [data-copilotkit-action]";
const MAX_ANCESTORS = 50;
const RECOVERY_DISTANCE_PX = 5;

interface Described {
  element: Element;
  target: Omit<ClickTarget, "input">;
}

interface PointerOrigin {
  described: Described | null;
  x: number;
  y: number;
}

/**
 * Finds the element a click means and describes it without reading any text.
 * Returns `null` inside `[data-copilotkit-ignore]` or for abnormal ancestor chains.
 */
export function describeTarget(el: Element) {
  let interactive: Element | null = null;
  let current: Element | null = el;
  for (let depth = 0; current !== null; depth += 1) {
    if (depth > MAX_ANCESTORS) return null;
    if (current.hasAttribute("data-copilotkit-ignore")) return null;
    if (interactive === null && current.matches(INTERACTIVE)) {
      interactive = current;
    }
    current = current.parentElement;
  }
  const element = interactive ?? el;
  const described: Described = {
    element,
    target: {
      tag: element.localName,
      role: element.getAttribute("role"),
      action: element.getAttribute("data-copilotkit-action"),
    },
  };
  return described;
}

function eventElement(event: Event) {
  const [first] = event.composedPath();
  return first instanceof Element ? first : null;
}

function isRootOrDetached(el: Element) {
  return el.localName === "body" || el.localName === "html" || !el.isConnected;
}

function isNear(origin: PointerOrigin, event: MouseEvent) {
  return (
    Math.abs(origin.x - event.clientX) <= RECOVERY_DISTANCE_PX &&
    Math.abs(origin.y - event.clientY) <= RECOVERY_DISTANCE_PX
  );
}

/**
 * Listens for clicks in the capture phase on `window`, so handlers that stop
 * propagation do not hide them. The target is described at `pointerdown`,
 * because a re-render before `click` can move the click to `<body>`.
 */
export function installClickCapture(params: {
  emit: Emit;
  getRoute: () => string;
  enrich?: EnrichFn;
  // ponytail: test seam only. jsdom cannot create trusted events; the collector never passes this.
  isTrusted?: (event: Event) => boolean;
}) {
  const {
    emit,
    getRoute,
    enrich,
    isTrusted = (event) => event.isTrusted,
  } = params;
  let origin: PointerOrigin | null = null;

  const onPointerDown = (event: PointerEvent) => {
    try {
      if (event.isPrimary === false) return;
      const el = eventElement(event);
      origin = {
        described: el === null ? null : describeTarget(el),
        x: event.clientX,
        y: event.clientY,
      };
    } catch {
      origin = null;
    }
  };

  const onClick = (event: MouseEvent) => {
    const pointerOrigin = origin;
    origin = null;
    try {
      if (!isTrusted(event)) return;
      const el = eventElement(event);
      if (el === null) return;
      const canRecover =
        pointerOrigin !== null &&
        isRootOrDetached(el) &&
        isNear(pointerOrigin, event);
      const described = canRecover
        ? pointerOrigin.described
        : describeTarget(el);
      if (described === null) return;
      const input = event.detail === 0 ? "keyboard" : "pointer";
      emit("click", {
        target: { ...described.target, input },
        route: getRoute(),
        ...enrich?.(described.element),
      });
    } catch {
      // Capture must never break the host app's click.
    }
  };

  window.addEventListener("pointerdown", onPointerDown, {
    capture: true,
    passive: true,
  });
  window.addEventListener("click", onClick, { capture: true, passive: true });
  return () => {
    window.removeEventListener("pointerdown", onPointerDown, { capture: true });
    window.removeEventListener("click", onClick, { capture: true });
  };
}
