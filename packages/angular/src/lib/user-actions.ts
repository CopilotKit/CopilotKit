import { inject } from "@angular/core";
import {
  recordUserAction,
  type RecordAnnotationResult,
  type UserActionInput,
} from "@copilotkit/core";
import { COPILOT_CHAT_CONFIGURATION } from "./chat-configuration";
import { CopilotKit } from "./copilotkit";

/** Input for recording a user action against an explicit thread. */
export interface LearnFromUserActionInput extends UserActionInput {}

/** Result returned after recording a user action. */
export type LearnFromUserActionResult = RecordAnnotationResult;

/** Function returned by {@link injectLearnFromUserAction}. */
export type LearnFromUserActionRecorder = (
  input: LearnFromUserActionInput,
) => Promise<LearnFromUserActionResult>;

/** Input for recording a user action against the ambient chat thread. */
export type LearnFromUserActionInCurrentThreadInput = Omit<
  LearnFromUserActionInput,
  "threadId"
>;

/** Function returned by {@link injectLearnFromUserActionInCurrentThread}. */
export type LearnFromUserActionInCurrentThreadRecorder = (
  input: LearnFromUserActionInCurrentThreadInput,
) => Promise<LearnFromUserActionResult>;

/**
 * Inject a recorder for user actions associated with an explicit thread.
 * Runtime configuration is read when the returned function is called.
 */
export function injectLearnFromUserAction(): LearnFromUserActionRecorder {
  const copilotKit = inject(CopilotKit);

  return async (input) => {
    const runtimeUrl = copilotKit.runtimeUrl();
    if (!runtimeUrl) {
      throw new Error(
        "injectLearnFromUserAction: runtimeUrl is not configured. Set it with provideCopilotKit({ runtimeUrl: ... }).",
      );
    }

    return recordUserAction({
      ...input,
      runtimeUrl,
      headers: copilotKit.headers(),
      credentials: copilotKit.credentials(),
    });
  };
}

/**
 * Inject a recorder that associates user actions with the ambient chat thread.
 * The thread is read when the returned function is called.
 */
export function injectLearnFromUserActionInCurrentThread(): LearnFromUserActionInCurrentThreadRecorder {
  const learnFromUserAction = injectLearnFromUserAction();
  const chatConfiguration = inject(COPILOT_CHAT_CONFIGURATION, {
    optional: true,
  });

  return async (input) => {
    const threadId = chatConfiguration?.threadId();
    if (!threadId) {
      throw new Error(
        "injectLearnFromUserActionInCurrentThread: no CopilotChatConfiguration in scope. Register provideCopilotChatConfiguration() in the shared injection scope or call injectLearnFromUserAction() with an explicit threadId.",
      );
    }
    return learnFromUserAction({ ...input, threadId });
  };
}
