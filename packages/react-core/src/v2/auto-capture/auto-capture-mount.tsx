import { useAutoCaptureUserActions } from "./use-auto-capture-user-actions";
import type { AutoCaptureUserActionsConfig } from "./types";

/**
 * Internal, render-free component that activates {@link useAutoCaptureUserActions}
 * from the `autoCaptureUserActions` prop on `<CopilotKitProvider>`. It is
 * mounted **inside** `CopilotKitContext` so the hook can read core + chat
 * context — mirroring the established `A2UIBuiltInToolCallRenderer` pattern.
 */
export function AutoCaptureMount({
  config,
}: {
  config: AutoCaptureUserActionsConfig;
}): null {
  useAutoCaptureUserActions(config);
  return null;
}
