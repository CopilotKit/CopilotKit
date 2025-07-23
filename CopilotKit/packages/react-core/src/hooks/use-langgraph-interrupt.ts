import { useContext, useEffect, useMemo } from "react";
import { CopilotContext } from "../context/copilot-context";
import { LangGraphInterruptRender } from "../types/interrupt-action";
import { useCopilotChat } from "./use-copilot-chat_internal";
import { useToast } from "../components/toast/toast-provider";
import { dataToUUID } from "@copilotkit/shared";

export function useLangGraphInterrupt<TEventValue = any>(
  action: Omit<LangGraphInterruptRender<TEventValue>, "id">,
  dependencies?: any[],
) {
  const { setLangGraphInterruptAction, removeLangGraphInterruptAction, langGraphInterruptAction } =
    useContext(CopilotContext);
  const { runChatCompletion } = useCopilotChat();
  const { addToast } = useToast();

  const actionId = dataToUUID(JSON.stringify(action), "lgAction");
  // We only consider action to be defined once the ID is there
  const hasAction = useMemo(
    () => Boolean(langGraphInterruptAction?.id),
    [langGraphInterruptAction],
  );

  const isCurrentAction = useMemo(
    () => langGraphInterruptAction?.id && langGraphInterruptAction?.id === actionId,
    [langGraphInterruptAction],
  );

  // Run chat completion to submit a response event. Only if it's the current action
  useEffect(() => {
    if (hasAction && isCurrentAction && langGraphInterruptAction?.event?.response) {
      runChatCompletion();
    }
  }, [langGraphInterruptAction?.event?.response, runChatCompletion, hasAction, isCurrentAction]);

  useEffect(() => {
    if (!action) return;
    // An action was already set, with no conditions and it's not the action we're using right now.
    // Show a warning, as this action will not be executed
    if (hasAction && !isCurrentAction && !action.enabled) {
      addToast({
        type: "warning",
        message: "An action is already registered for the interrupt event",
      });
      return;
    }

    if (hasAction && isCurrentAction) {
      return;
    }

    setLangGraphInterruptAction({ ...action, id: actionId });
  }, [
    action,
    hasAction,
    isCurrentAction,
    setLangGraphInterruptAction,
    removeLangGraphInterruptAction,
    ...(dependencies || []),
  ]);
}
