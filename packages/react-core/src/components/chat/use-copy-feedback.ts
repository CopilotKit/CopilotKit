import { useEffect, useState, useSyncExternalStore } from "react";
import { ɵCopyFeedback } from "@copilotkit/core";

/**
 * The "copied" check mark of a copy button, from core's `ɵCopyFeedback`: it
 * shows for two seconds after `markCopied()`, and a second copy restarts the
 * wait.
 */
export function useCopyFeedback() {
  const [feedback] = useState(() => new ɵCopyFeedback());
  const copied = useSyncExternalStore(
    feedback.subscribe,
    feedback.getSnapshot,
    feedback.getSnapshot,
  );
  useEffect(() => feedback.dispose, [feedback]);
  return { copied, markCopied: feedback.markCopied };
}
