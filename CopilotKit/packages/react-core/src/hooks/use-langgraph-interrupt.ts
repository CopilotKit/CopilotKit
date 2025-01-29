import { useCallback, useContext, useEffect } from "react";
import { CopilotContext } from "../context/copilot-context";
import { LangGraphInterruptRender } from "../types/interrupt-action";
import { useCopilotChat } from "./use-copilot-chat";
import { useToast } from "../components/toast/toast-provider";
import { dataToUUID } from "@copilotkit/shared";

export function useLangGraphInterrupt(action: LangGraphInterruptRender, dependencies?: any[]) {
  const { setLangGraphInterruptAction, removeLangGraphInterruptAction, langGraphInterruptAction } =
    useContext(CopilotContext);
  const { runChatCompletion } = useCopilotChat();
  const actionId = dataToUUID(JSON.stringify(action), "lgAction");
  const { addToast } = useToast();
  const isCurrentAction =
    !langGraphInterruptAction ||
    (langGraphInterruptAction?.id && langGraphInterruptAction?.id === actionId);

  // Run chat completion to submit a response event. Only if it's the current action
  useEffect(() => {
    if (isCurrentAction && langGraphInterruptAction?.event?.response) {
      runChatCompletion();
    }
  }, [langGraphInterruptAction?.event?.response, runChatCompletion]);

  useEffect(() => {
    // An action was already set, with no conditions and it's not the action we're using right now.
    // Show a warning, as this action will not be executed
    if (!isCurrentAction && !langGraphInterruptAction?.conditions?.length) {
      addToast({
        type: "warning",
        message: "An action is already registered for the interrupt event",
      });
      return;
    }

    if (isCurrentAction) {
      return;
    }

    setLangGraphInterruptAction({ ...action, id: actionId });

    return () => {
      removeLangGraphInterruptAction();
    };
  }, [
    setLangGraphInterruptAction,
    removeLangGraphInterruptAction,
    langGraphInterruptAction,
    ...(dependencies || []),
  ]);
}
