import { useCallback } from "react";
import { recordUserAction } from "@copilotkit/core";
import type { RecordAnnotationResult, UserActionInput } from "@copilotkit/core";
import { useCopilotKit } from "../context";

/**
 * Input to {@link UseLearnFromUserActionRecorder}, the function returned
 * by {@link useLearnFromUserAction}. Captures a single UI interaction that
 * the Intelligence platform's auto-curated knowledge base loop will distill
 * into the team's `/project` notes.
 */
export interface LearnFromUserActionInput extends UserActionInput {}

/** Outcome returned by the recorder function. */
export interface LearnFromUserActionResult extends RecordAnnotationResult {}

/** Recorder function returned by {@link useLearnFromUserAction}. */
export type UseLearnFromUserActionRecorder = (
  input: LearnFromUserActionInput,
) => Promise<LearnFromUserActionResult>;

/**
 * Record a user UI interaction in the Intelligence platform's user-actions
 * stream. The platform's auto-curated knowledge base agent reads these
 * (alongside finished agent runs) and writes free-form Obsidian-flavored
 * markdown to `/project`, where any agent in the same project can later
 * read it via the `copilotkit_knowledge_base_shell` MCP tool.
 *
 * The hook returns a stable function. Calling it issues a request to the
 * customer's CopilotKit runtime (`POST ${runtimeUrl}/annotate`), which
 * resolves the Intel user from the BFF's auth and forwards to the
 * platform — the Intel API key never reaches the browser.
 *
 * If `clientEventId` is omitted, `recordUserAction` generates a fresh UUID for
 * each call. Supply and reuse an explicit ID when retrying the same semantic
 * event so the platform can recognize the duplicate.
 *
 * @example
 * ```tsx
 * import { useLearnFromUserAction } from "@copilotkit/react-core";
 *
 * function SettingsPage({ threadId }) {
 *   const learnFromUserAction = useLearnFromUserAction();
 *
 *   const onRename = (oldName: string, newName: string) => {
 *     void learnFromUserAction({
 *       threadId,
 *       title: "Renamed project",
 *       data: { previous: { name: oldName }, next: { name: newName } },
 *     });
 *   };
 * }
 * ```
 */
export function useLearnFromUserAction(): UseLearnFromUserActionRecorder {
  const { copilotkit } = useCopilotKit();

  return useCallback(
    async (
      input: LearnFromUserActionInput,
    ): Promise<LearnFromUserActionResult> => {
      const runtimeUrl = copilotkit.runtimeUrl;
      if (!runtimeUrl) {
        throw new Error(
          "useLearnFromUserAction: runtimeUrl is not configured. Set it on <CopilotKitProvider runtimeUrl=...>.",
        );
      }

      return recordUserAction({
        ...input,
        runtimeUrl,
        headers: copilotkit.headers ?? {},
        credentials: copilotkit.credentials,
      });
    },
    [copilotkit],
  );
}
