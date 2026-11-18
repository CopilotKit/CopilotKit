import { useCallback } from "react";
import { useCopilotChatConfiguration } from "../providers";
import type {
  LearnFromUserActionInput,
  LearnFromUserActionResult,
} from "./use-learn-from-user-action";
import { useLearnFromUserAction } from "./use-learn-from-user-action";

/**
 * Input to {@link UseLearnFromUserActionInCurrentThreadRecorder} — same as
 * {@link LearnFromUserActionInput} minus `threadId`, which is sourced from
 * the surrounding `<CopilotChatConfigurationProvider>` at call time.
 */
export type LearnFromUserActionInCurrentThreadInput = Omit<
  LearnFromUserActionInput,
  "threadId"
>;

/** Recorder function returned by {@link useLearnFromUserActionInCurrentThread}. */
export type UseLearnFromUserActionInCurrentThreadRecorder = (
  input: LearnFromUserActionInCurrentThreadInput,
) => Promise<LearnFromUserActionResult>;

/**
 * Record a user UI interaction against the **current chat's** thread. The
 * `threadId` is sourced from the surrounding
 * `<CopilotChatConfigurationProvider>` (the same provider `<CopilotChat>`,
 * `<CopilotSidebar>`, and friends set up), so callers in a chat-aware
 * subtree don't need to thread an id through manually.
 *
 * Throws on **call** (not on mount) when there is no chat-config provider
 * in scope — matches the "throw on call when runtimeUrl is missing"
 * behavior of {@link useLearnFromUserAction}. Mounting the hook in a branch
 * that never fires is harmless.
 *
 * The recorder does NOT accept a `threadId` override. If you need to
 * record against an explicit thread, use {@link useLearnFromUserAction}
 * directly — two hooks, two crisp contracts, no mode confusion.
 *
 * This hook always uses `config.threadId`, regardless of whether the
 * surrounding chat config minted it internally or received one from
 * the caller. Auto-minted threads simply mean the action lands under
 * a thread the platform never saw — the writer agent still distills
 * user-action-only threads (it does not require the thread to exist
 * in `cpki.threads`), so the loop keeps learning.
 *
 * @example
 * ```tsx
 * import { useLearnFromUserActionInCurrentThread } from "@copilotkit/react-core";
 *
 * function SettingsPanel() {
 *   const learnFromUserAction = useLearnFromUserActionInCurrentThread();
 *
 *   const onRename = (oldName: string, newName: string) => {
 *     void learnFromUserAction({
 *       title: "Renamed project",
 *       data: { previous: { name: oldName }, next: { name: newName } },
 *     });
 *   };
 *
 *   // ...
 * }
 * ```
 */
export function useLearnFromUserActionInCurrentThread(): UseLearnFromUserActionInCurrentThreadRecorder {
  const config = useCopilotChatConfiguration();
  const learnFromUserAction = useLearnFromUserAction();

  return useCallback(
    async (
      input: LearnFromUserActionInCurrentThreadInput,
    ): Promise<LearnFromUserActionResult> => {
      const threadId = config?.threadId;
      if (!threadId) {
        throw new Error(
          "useLearnFromUserActionInCurrentThread: no CopilotChatConfigurationProvider in scope. " +
            "Wrap the call site in <CopilotChat>, <CopilotSidebar>, or <CopilotChatConfigurationProvider>, " +
            "or use `useLearnFromUserAction()` and pass `threadId` explicitly.",
        );
      }
      return learnFromUserAction({ ...input, threadId });
    },
    [config?.threadId, learnFromUserAction],
  );
}
