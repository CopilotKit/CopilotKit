/**
 * <Callout type="info">
 *   Usage of this hook assumes some additional setup in your application, for more information
 *   on that see the CoAgents <span className="text-blue-500">[Agentic Generative UI documentation](/coagents/chat-ui/render-agent-state)</span>.
 * </Callout>
 *
 * The useLangGraphInterrupt hook allows you to render UI components or text as a reaction to an `interrupt` call in your agent.
 *
 * ## Usage
 *
 * ### Simple Usage
 *
 * ```tsx
 * import { useLangGraphInterrupt } from "@copilotkit/react-core";
 *
 * useLangGraphInterrupt({
 *   render: ({ result, event, resolve }) => {
 *     const handleAuth = () => {
 *        ... handle auth
 *        if (authenticated) {
 *          resolve('success')
 *          return;
 *        }
 *        resolve('failure')
 *     }
 *     return (
 *       <div>
 *           Welcome. Click the button below to sign in
 *           <Button onClick={handleAuth}>Sign In</Button>
 *       </div>
 *     );
 *   },
 * });
 * ```
 *
 * This allows for you to render UI components or text based on the `interrupt` thrown in the agent
 */

import { useContext, useEffect } from "react";
import { CopilotContext } from "../context/copilot-context";
import { LangGraphInterruptRender } from "../types/interrupt-action";
import { useCopilotChat } from "./use-copilot-chat";
import { useToast } from "../components/toast/toast-provider";
import { dataToUUID } from "@copilotkit/shared";

export function useLangGraphInterrupt(
  action: Omit<LangGraphInterruptRender, "id">,
  dependencies?: any[],
) {
  const { setLangGraphInterruptAction, removeLangGraphInterruptAction, langGraphInterruptAction } =
    useContext(CopilotContext);
  const { runChatCompletion } = useCopilotChat();
  const actionId = dataToUUID(JSON.stringify(action), "lgAction");
  const { addToast } = useToast();

  // We only consider action to be defined once the ID is there
  const hasAction = langGraphInterruptAction?.id
  // We consider the passed action to be current (aka no other action already specified) if:
  // Either no action was defined before, or the action in system is equal in ID
  const isCurrentAction =
    !hasAction ||
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
