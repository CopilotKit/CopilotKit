import { describeTarget, readControlValue } from "./clicks";
import { createRedactor } from "./redact";
import type { Redactor } from "./redact";
import type { Emit } from "./types";

/** Records user edits without changing the control or interfering with its listeners. */
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
  const onInput = (event: Event) => {
    try {
      if (!isTrusted(event)) return;
      const [element] = event.composedPath();
      if (!(element instanceof Element)) return;
      const described = describeTarget(element, redact);
      if (described === null) return;
      const value = readControlValue(element, redact);
      if (!("value" in value)) return;
      emit("input", {
        eventType: event.type,
        target: { ...described.target, ...value },
        url: redact.url(location.href),
        route: location.pathname,
      });
    } catch {
      // Capture must never break an edit in the host app.
    }
  };
  window.addEventListener("input", onInput, { capture: true, passive: true });
  window.addEventListener("change", onInput, { capture: true, passive: true });
  return () => {
    window.removeEventListener("input", onInput, { capture: true });
    window.removeEventListener("change", onInput, { capture: true });
  };
}
