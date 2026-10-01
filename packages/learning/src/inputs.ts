import { describeTarget, readControlValue } from "./clicks";
import type { Emit } from "./types";

/** Records user edits without changing the control or interfering with its listeners. */
export function installInputCapture(params: {
  emit: Emit;
  isTrusted?: (event: Event) => boolean;
}) {
  const { emit, isTrusted = (event: Event) => event.isTrusted } = params;
  const onInput = (event: Event) => {
    try {
      if (!isTrusted(event)) return;
      const [element] = event.composedPath();
      if (!(element instanceof Element)) return;
      const described = describeTarget(element);
      if (described === null) return;
      const value = readControlValue(element);
      if (!("value" in value)) return;
      emit("input", {
        eventType: event.type,
        target: { ...described.target, ...value },
        url: location.href,
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
