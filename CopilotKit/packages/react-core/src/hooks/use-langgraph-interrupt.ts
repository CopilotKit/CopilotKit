import { useContext, useEffect, useMemo } from "react";
import { CopilotContext } from "../context/copilot-context";
import { LangGraphInterruptRender } from "../types/interrupt-action";
import { useCopilotChatInternal } from "./use-copilot-chat_internal";
import { useToast } from "../components/toast/toast-provider";
import { dataToUUID } from "@copilotkit/shared";

export function useLangGraphInterrupt<TEventValue = any>(
  action: Omit<LangGraphInterruptRender<TEventValue>, "id">,
  dependencies?: any[],
) {
  const { setInterruptAction, removeLangGraphInterruptAction, interruptActions, threadId } =
    useContext(CopilotContext);
  // const { agent } = useCopilotChatInternal();
  const { addToast } = useToast();

  const actionId = dataToUUID(JSON.stringify(action), "lgAction");
  const currentAction = interruptActions[threadId];

  const hasAction = useMemo(() => Boolean(currentAction?.id), [currentAction]);

  const isCurrentAction = useMemo(
    () => currentAction?.id && currentAction?.id === actionId,
    [currentAction],
  );

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

    setInterruptAction(threadId, { ...action, id: actionId });
  }, [
    action,
    hasAction,
    isCurrentAction,
    setInterruptAction,
    removeLangGraphInterruptAction,
    threadId,
    ...(dependencies || []),
  ]);
}
