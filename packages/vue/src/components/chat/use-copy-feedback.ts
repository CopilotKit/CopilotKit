import { onBeforeUnmount, readonly, ref } from "vue";
import { ɵCopyFeedback } from "@copilotkit/core";

/**
 * The "copied" check mark of a copy button, from core's `ɵCopyFeedback`:
 * `copy(text)` writes to the clipboard and shows the check mark for two
 * seconds; a second copy restarts the wait.
 * @internal
 */
export function useCopyFeedback() {
  const feedback = new ɵCopyFeedback();
  const copied = ref(feedback.getSnapshot());
  const unsubscribe = feedback.subscribe(() => {
    copied.value = feedback.getSnapshot();
  });
  onBeforeUnmount(() => {
    unsubscribe();
    feedback.dispose();
  });
  return { copied: readonly(copied), copy: feedback.copy };
}
