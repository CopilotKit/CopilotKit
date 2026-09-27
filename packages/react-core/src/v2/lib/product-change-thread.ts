import type { ProductInteractionEvent } from "@copilotkit/learning";

/** Preserve the editing thread when a pointer switch commits the old field. */
export function trackProductChangeThreads(
  target: Window,
  getCurrentThreadId: () => string | undefined,
) {
  type Origin = { threadId: string | undefined };
  let edits = new WeakMap<EventTarget, Origin>();
  let committed: Origin | undefined;

  const onInput = (event: Event) => {
    if (!event.isTrusted || !event.target || edits.has(event.target)) return;
    // Keep only identity and attribution, never input values or keystrokes.
    edits.set(event.target, { threadId: getCurrentThreadId() });
  };
  const onChange = (event: Event) => {
    if (!event.isTrusted || !event.target) return;
    committed = edits.get(event.target);
    edits.delete(event.target);
  };
  const onFocusOut = (event: Event) => {
    // Reverting to the original value emits no change. End that edit anyway,
    // so a later focus session cannot inherit its old thread.
    if (event.isTrusted && event.target) edits.delete(event.target);
  };

  // Window capture runs before the generic capture library's document listener,
  // regardless of the order in which React installs their effects.
  target.addEventListener("input", onInput, true);
  target.addEventListener("change", onChange, true);
  target.addEventListener("focusout", onFocusOut, true);

  return {
    getThreadId(event: ProductInteractionEvent) {
      if (event.type === "interaction" && event.action === "change") {
        const origin = committed;
        committed = undefined;
        if (origin) return origin.threadId;
      }
      return getCurrentThreadId();
    },
    stop() {
      target.removeEventListener("input", onInput, true);
      target.removeEventListener("change", onChange, true);
      target.removeEventListener("focusout", onFocusOut, true);
      edits = new WeakMap();
      committed = undefined;
    },
  };
}
