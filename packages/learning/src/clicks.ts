import { createRedactor, isCredentialKey } from "./redact";
import type { Redactor } from "./redact";
import { REDACTED } from "./types";
import type { ClickTarget, Emit, EnrichFn } from "./types";

const INTERACTIVE =
  'button, a[href], input, select, textarea, label, summary, [role], [data-copilotkit-action], [contenteditable]:not([contenteditable="false"])';
const RECOVERY_DISTANCE_PX = 5;
// `[role]` also matches containers such as role="main"; cap their text so one
// click cannot exceed the 16 KiB event limit and be dropped.
const MAX_TEXT_LENGTH = 1000;

/** `closest()` that continues through shadow roots to their hosts. */
function closestAcrossShadow(el: Element, selector: string) {
  let current: Element | null = el;
  while (current !== null) {
    const match = current.closest(selector);
    if (match !== null) return match;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

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
 * Finds the nearest interactive element and retains its text, attributes, and value.
 * The explicit `data-copilotkit-ignore` opt-out still applies.
 */
export function describeTarget(el: Element, redact: Redactor) {
  if (closestAcrossShadow(el, "[data-copilotkit-ignore]") !== null) return null;
  const element = el.closest(INTERACTIVE) ?? el;
  // React and server markup can mirror the password into the value attribute.
  const password = redact.isPassword(element);
  const described: Described = {
    element,
    target: {
      tag: element.localName,
      role: element.getAttribute("role"),
      action: element.getAttribute("data-copilotkit-action"),
      text: (element.textContent ?? "").slice(0, MAX_TEXT_LENGTH),
      attributes: Object.fromEntries(
        Array.from(element.attributes, ({ name, value }) => [
          name,
          // Credential-named attributes (`data-api-key`) are redacted whole;
          // URL-valued ones (`href`, `action`, …) can carry credentials too.
          (password && name === "value") ||
          isCredentialKey(name.replace(/^data-/, ""))
            ? REDACTED
            : redact.url(value),
        ]),
      ),
      ...readControlValue(element, redact),
    },
  };
  return described;
}

/** Snapshot live control properties; HTML attributes do not reflect edited values. */
export function readControlValue(element: Element, redact: Redactor) {
  if (element instanceof HTMLInputElement) {
    return {
      value: redact.isPassword(element) ? REDACTED : element.value,
      ...(["checkbox", "radio"].includes(element.type)
        ? { checked: element.checked }
        : {}),
      ...(element.type === "file"
        ? {
            files: Array.from(element.files ?? [], (file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
              lastModified: file.lastModified,
            })),
          }
        : {}),
    };
  }
  if (element instanceof HTMLSelectElement) {
    return {
      value: element.value,
      selectedValues: Array.from(
        element.selectedOptions,
        (option) => option.value,
      ),
    };
  }
  if (element instanceof HTMLTextAreaElement) return { value: element.value };
  if (element.matches('[contenteditable]:not([contenteditable="false"])')) {
    return { value: element.textContent ?? "" };
  }
  return {};
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
  redact?: Redactor;
}) {
  const {
    emit,
    getRoute,
    enrich,
    isTrusted = (event) => event.isTrusted,
    redact = createRedactor(),
  } = params;
  let origin: PointerOrigin | null = null;

  const onPointerDown = (event: PointerEvent) => {
    try {
      if (event.isPrimary === false) return;
      const el = eventElement(event);
      origin = {
        described: el === null ? null : describeTarget(el, redact),
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
        : describeTarget(el, redact);
      if (described === null) return;
      const input = event.detail === 0 ? "keyboard" : "pointer";
      emit("click", {
        target: { ...described.target, input },
        route: getRoute(),
        url: redact.url(location.href),
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
