import { describeTarget, readControlValue } from "./clicks";
import { createRedactor } from "./redact";
import type { Redactor } from "./redact";
import { REDACTED } from "./types";
import type { ClickTarget, Emit } from "./types";

const TEXT_DEBOUNCE_MS = 300;
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "tel",
  "url",
  "email",
  "password",
  "number",
]);
type ControlValue = ReturnType<typeof readControlValue>;
interface Edit {
  state: ControlValue;
  payload: {
    eventType: string;
    target: Omit<ClickTarget, "input">;
    url: string;
    route: string;
  };
  timer?: ReturnType<typeof setTimeout>;
}

/** Records settled user edits without interfering with the host app's controls. */
export function installInputCapture(params: {
  emit: Emit;
  isTrusted?: (event: Event) => boolean;
  redact?: Redactor;
}) {
  const {
    emit,
    isTrusted = (event: Event) => event.isTrusted,
    redact = createRedactor(),
  } = params;
  let active = true;
  const pending = new Map<Element, Edit>();
  // A native change can echo a settled input on blur. Consume that one echo;
  // every fresh trusted input is a new edit, even if its redacted value matches.
  const changeEcho = new WeakMap<Element, string>();
  const composing = new WeakMap<Element, boolean>();

  const cancel = (element: Element) => {
    clearTimeout(pending.get(element)?.timer);
    pending.delete(element);
  };
  const deliver = (element: Element, edit: Edit) => {
    try {
      // Recheck privacy, but retain the observed value and route even if a host
      // handler reset or removed the control before this trailing delivery.
      if (!active || describeTarget(element, redact) === null) return;
      // A host can reset the live value before making this field sensitive.
      // Drop the old snapshot: mirrored text/attributes may contain its value.
      if (redact.isPassword(element) && edit.state.value !== REDACTED) return;
      if (edit.payload.eventType === "input") {
        changeEcho.set(element, JSON.stringify(edit.state));
      }
      edit.payload.url = redact.url(edit.payload.url);
      edit.payload.target.text = redact.url(edit.payload.target.text);
      edit.payload.target.attributes = Object.fromEntries(
        Object.entries(edit.payload.target.attributes).map(([key, value]) => [
          key,
          redact.url(value),
        ]),
      );
      emit("input", edit.payload);
    } catch {
      // Capture must never break an edit or a later action in the host app.
    }
  };
  const flush = () => {
    // Clear before callbacks: an emit can synchronously stop or restart capture.
    const edits = [...pending];
    for (const [element] of edits) cancel(element);
    for (const [element, edit] of edits) deliver(element, edit);
  };
  const observe = (element: Element, eventType: string, settle: boolean) => {
    if (pending.size > 0 && !pending.has(element)) flush();
    if (!active) return;
    const described = describeTarget(element, redact);
    if (described === null) {
      cancel(element);
      return;
    }
    const state = readControlValue(element, redact);
    if (!("value" in state)) return;
    const text =
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        TEXT_INPUT_TYPES.has(element.type)) ||
      element.matches('[contenteditable]:not([contenteditable="false"])');
    if (!text) flush();
    const signature = JSON.stringify(state);
    const echo =
      eventType === "change" &&
      (signature === JSON.stringify(pending.get(element)?.state) ||
        signature === changeEcho.get(element));
    changeEcho.delete(element);
    if (echo) {
      flush();
      changeEcho.delete(element);
      return;
    }
    cancel(element);
    const edit: Edit = {
      state,
      payload: {
        eventType,
        target: { ...described.target, ...state },
        url: redact.url(location.href),
        route: location.pathname,
      },
    };
    if (!text) {
      deliver(element, edit);
      return;
    }
    if (settle) {
      edit.timer = setTimeout(() => {
        cancel(element);
        deliver(element, edit);
      }, TEXT_DEBOUNCE_MS);
    }
    pending.set(element, edit);
  };
  const onEdit = (event: Event) => {
    try {
      if (!active || !isTrusted(event)) return;
      const [element] = event.composedPath();
      if (!(element instanceof Element)) return;
      if (event.type === "compositionstart") {
        composing.set(element, true);
        clearTimeout(pending.get(element)?.timer);
        return;
      }
      if (event.type === "compositionend") composing.set(element, false);
      // Keep a draft during composition for explicit action/stop flushes. An
      // end event takes precedence over a late input's stale isComposing flag.
      const inComposition =
        composing.get(element) === true ||
        (composing.get(element) !== false &&
          "isComposing" in event &&
          event.isComposing === true);
      observe(
        element,
        event.type === "compositionend" ? "input" : event.type,
        !inComposition,
      );
      if (event.type === "change") flush();
    } catch {
      // Capture must never break an edit in the host app.
    }
  };
  const onAction = (event: Event) => {
    if (event.type !== "pagehide" && !isTrusted(event)) return;
    if (event.type === "keydown") {
      const [element] = event.composedPath();
      // Window capture runs before no-form send handlers can reset the control.
      // IME completion can precede its final keydown, which still reports 229.
      if (
        !(event instanceof KeyboardEvent) ||
        event.key !== "Enter" ||
        event.isComposing ||
        event.keyCode === 229 ||
        (element instanceof Element && composing.get(element) === true)
      )
        return;
    }
    flush();
  };
  const editTypes = ["input", "change", "compositionstart", "compositionend"];
  const actionTypes = ["click", "submit", "focusout", "pagehide", "keydown"];
  for (const type of editTypes)
    window.addEventListener(type, onEdit, { capture: true, passive: true });
  for (const type of actionTypes)
    window.addEventListener(type, onAction, { capture: true, passive: true });
  const uninstall = () => {
    active = false;
    for (const element of pending.keys()) cancel(element);
    for (const type of editTypes)
      window.removeEventListener(type, onEdit, true);
    for (const type of actionTypes)
      window.removeEventListener(type, onAction, true);
  };
  return Object.assign(uninstall, { flush });
}
