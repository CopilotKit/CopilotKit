import { useCallback } from "react";
import { useCopilotChatConfiguration } from "../providers";
import {
  RecordUserActionInput,
  RecordUserActionResult,
  useRecordUserAction,
} from "./use-record-user-action";

/**
 * Input to {@link UseRecordUserActionInCurrentThreadRecorder} — same as
 * {@link RecordUserActionInput} minus `threadId`, which is sourced from
 * the surrounding `<CopilotChatConfigurationProvider>` at call time.
 */
export type RecordUserActionInCurrentThreadInput = Omit<
  RecordUserActionInput,
  "threadId"
>;

/** Recorder function returned by {@link useRecordUserActionInCurrentThread}. */
export type UseRecordUserActionInCurrentThreadRecorder = (
  input: RecordUserActionInCurrentThreadInput,
) => Promise<RecordUserActionResult>;

/**
 * Record a user UI interaction against the **current chat's** thread. The
 * `threadId` is sourced from the surrounding
 * `<CopilotChatConfigurationProvider>` (the same provider `<CopilotChat>`,
 * `<CopilotSidebar>`, and friends set up), so callers in a chat-aware
 * subtree don't need to thread an id through manually.
 *
 * Throws on **call** (not on mount) when there is no chat-config provider
 * in scope — matches the "throw on call when runtimeUrl is missing"
 * behavior of {@link useRecordUserAction}. Mounting the hook in a branch
 * that never fires is harmless.
 *
 * The recorder does NOT accept a `threadId` override. If you need to
 * record against an explicit thread, use {@link useRecordUserAction}
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
 * import { useRecordUserActionInCurrentThread } from "@copilotkit/react-core";
 *
 * function SettingsPanel() {
 *   const recordUserAction = useRecordUserActionInCurrentThread();
 *
 *   const onRename = (oldName: string, newName: string) => {
 *     void recordUserAction({
 *       title: "Renamed project",
 *       previousData: { name: oldName },
 *       newData: { name: newName },
 *     });
 *   };
 *
 *   // ...
 * }
 * ```
 */
export function useRecordUserActionInCurrentThread(): UseRecordUserActionInCurrentThreadRecorder {
  const config = useCopilotChatConfiguration();
  const recordUserAction = useRecordUserAction();

  return useCallback(
    async (
      input: RecordUserActionInCurrentThreadInput,
    ): Promise<RecordUserActionResult> => {
      const threadId = config?.threadId;
      if (!threadId) {
        throw new Error(
          "useRecordUserActionInCurrentThread: no CopilotChatConfigurationProvider in scope. " +
            "Wrap the call site in <CopilotChat>, <CopilotSidebar>, or <CopilotChatConfigurationProvider>, " +
            "or use `useRecordUserAction()` and pass `threadId` explicitly.",
        );
      }
      return recordUserAction({ ...input, threadId });
    },
    [config?.threadId, recordUserAction],
  );
}
