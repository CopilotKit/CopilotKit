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
  const { setInterruptAction, removeInterruptAction, interruptActions, threadId } =
    useContext(CopilotContext);
  const { addToast } = useToast();

  const actionId = useMemo(() => {
    const serializable = {
      handler: action.handler?.toString(),
      render: action.render?.toString(),
      enabled: action.enabled?.toString(),
    };
    return dataToUUID(JSON.stringify(serializable), "lgAction");
  }, [action.handler, action.render, action.enabled]);

  useEffect(() => {
    if (!action) return;

    // if (!action.enabled) {
    // TODO: if there are any other actions registered, we need to warn the user that a current action without "enabled" might render for everything
    //   addToast({
    //     type: "warning",
    //     message: "An action is already registered for the interrupt event",
    //   });
    //   return;
    // }

    setInterruptAction({ ...action, id: actionId });

    // Cleanup: remove action on unmount
    return () => {
      removeInterruptAction(actionId);
    };
  }, [setInterruptAction, removeInterruptAction, threadId, actionId, ...(dependencies || [])]);
}
