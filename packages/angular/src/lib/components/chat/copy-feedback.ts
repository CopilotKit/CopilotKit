import { DestroyRef, inject, signal } from "@angular/core";
import { ɵCopyFeedback } from "@copilotkit/core";

/**
 * The "copied" check mark of a copy button, from core's `ɵCopyFeedback`:
 * `copy(text)` writes to the clipboard and shows the check mark for two
 * seconds; a second copy restarts the wait. Call it in an injection context.
 */
export function injectCopyFeedback() {
  const feedback = new ɵCopyFeedback();
  const copied = signal(feedback.getSnapshot());
  const unsubscribe = feedback.subscribe(() =>
    copied.set(feedback.getSnapshot()),
  );
  inject(DestroyRef).onDestroy(() => {
    unsubscribe();
    feedback.dispose();
  });
  return { copied: copied.asReadonly(), copy: feedback.copy };
}
