/**
 * Example usage of useCopilotAction with complex parameters:
 *
 * @example
 * useCopilotAction({
 *   name: "myAction",
 *   parameters: [
 *     { name: "arg1", type: "string", enum: ["option1", "option2", "option3"], required: false },
 *     { name: "arg2", type: "number" },
 *     {
 *       name: "arg3",
 *       type: "object",
 *       attributes: [
 *         { name: "nestedArg1", type: "boolean" },
 *         { name: "xyz", required: false },
 *       ],
 *     },
 *     { name: "arg4", type: "number[]" },
 *   ],
 *   handler: ({ arg1, arg2, arg3, arg4 }) => {
 *     const x = arg3.nestedArg1;
 *     const z = arg3.xyz;
 *     console.log(arg1, arg2, arg3);
 *   },
 * });
 *
 * @example
 * // Simple action without parameters
 * useCopilotAction({
 *   name: "myAction",
 *   handler: () => {
 *     console.log("No parameters provided.");
 *   },
 * });
 *
 * @example
 * // Interactive action with UI rendering and response handling
 * useCopilotAction({
 *   name: "handleMeeting",
 *   description: "Handle a meeting by booking or canceling",
 *   parameters: [
 *     {
 *       name: "meeting",
 *       type: "string",
 *       description: "The meeting to handle",
 *       required: true,
 *     },
 *     {
 *       name: "date",
 *       type: "string",
 *       description: "The date of the meeting",
 *       required: true,
 *     },
 *     {
 *       name: "title",
 *       type: "string",
 *       description: "The title of the meeting",
 *       required: true,
 *     },
 *   ],
 *   renderAndWaitForResponse: ({ args, respond, status }) => {
 *     const { meeting, date, title } = args;
 *     return (
 *       <MeetingConfirmationDialog
 *         meeting={meeting}
 *         date={date}
 *         title={title}
 *         onConfirm={() => respond('meeting confirmed')}
 *         onCancel={() => respond('meeting canceled')}
 *       />
 *     );
 *   },
 * });
 *
 * @example
 * // Catch all action allows you to render actions that are not defined in the frontend
 * useCopilotAction({
 *   name: "*",
 *   render: ({ name, args, status, result, handler, respond }) => {
 *     return <div>Rendering action: {name}</div>;
 *   },
 * });
 */

/**
 * <img src="https://cdn.copilotkit.ai/docs/copilotkit/images/use-copilot-action/useCopilotAction.gif" width="500" />
 * `useCopilotAction` is a React hook that you can use in your application to provide
 * custom actions that can be called by the AI. Essentially, it allows the Copilot to
 * execute these actions contextually during a chat, based on the user's interactions
 * and needs.
 *
 * Here's how it works:
 *
 * Use `useCopilotAction` to set up actions that the Copilot can call. To provide
 * more context to the Copilot, you can provide it with a `description` (for example to explain
 * what the action does, under which conditions it can be called, etc.).
 *
 * Then you define the parameters of the action, which can be simple, e.g. primitives like strings or numbers,
 * or complex, e.g. objects or arrays.
 *
 * Finally, you provide a `handler` function that receives the parameters and returns a result.
 * CopilotKit takes care of automatically inferring the parameter types, so you get type safety
 * and autocompletion for free.
 *
 * To render a custom UI for the action, you can provide a `render()` function. This function
 * lets you render a custom component or return a string to display.
 *
 * ## Usage
 *
 * ### Simple Usage
 *
 * ```tsx
 * useCopilotAction({
 *   name: "sayHello",
 *   description: "Say hello to someone.",
 *   parameters: [
 *     {
 *       name: "name",
 *       type: "string",
 *       description: "name of the person to say greet",
 *     },
 *   ],
 *   handler: async ({ name }) => {
 *     alert(`Hello, ${name}!`);
 *   },
 * });
 * ```
 *
 * ## Generative UI
 *
 * This hooks enables you to dynamically generate UI elements and render them in the copilot chat. For more information, check out the [Generative UI](/guides/generative-ui) page.
 */
import { Parameter, randomId } from "@copilotkit/shared";
import { createElement, Fragment, useEffect, useRef } from "react";
import { useCopilotContext } from "../context/copilot-context";
import { useAsyncCallback } from "../components/error-boundary/error-utils";
import {
  ActionRenderProps,
  ActionRenderPropsNoArgsWait,
  ActionRenderPropsWait,
  CatchAllFrontendAction,
  FrontendAction,
} from "../types/frontend-action";
import { useToast } from "../components/toast/toast-provider";

// We implement useCopilotAction dependency handling so that
// the developer has the option to not provide any dependencies.
// In this case, we assume they want to update the handler on each rerender.
// To avoid getting stuck in an infinite loop, we update the handler directly,
// skipping React state updates.
// This is ok in this case, because the handler is not part of any UI that
// needs to be updated.
// useCallback, useMemo or other memoization techniques are not suitable here,
// because they will cause a infinite rerender loop.
export function useCopilotAction<const T extends Parameter[] | [] = []>(
  action: FrontendAction<T> | CatchAllFrontendAction,
  dependencies?: any[],
): void {
  const { setAction, removeAction, actions, chatComponentsCache } = useCopilotContext();
  const idRef = useRef<string>(randomId());
  const renderAndWaitRef = useRef<RenderAndWaitForResponse | null>(null);
  const activatingMessageIdRef = useRef<string | null>(null);
  const { addToast } = useToast();

  // clone the action to avoid mutating the original object
  action = { ...action };

  // const { currentlyActivatingHitlActionMessageIdRef } = useCopilotContext() as any; // <-- REMOVE THIS FOR NOW

  // If the developer provides a renderAndWaitForResponse function, we transform the action
  // to use a promise internally, so that we can treat it like a normal action.
  if (
    // renderAndWaitForResponse is not available for catch all actions
    isFrontendAction(action) &&
    // check if renderAndWaitForResponse is set
    (action.renderAndWait || action.renderAndWaitForResponse)
  ) {
    (action as any)._isRenderAndWait = true; // Internal flag to identify this action type later
    const renderAndWait = action.renderAndWait || action.renderAndWaitForResponse;
    // remove the renderAndWait function from the action
    action.renderAndWait = undefined;
    action.renderAndWaitForResponse = undefined;

    // Add a method for use-chat.ts to set the activating message ID.
    // This helps correlate the action instance with the message being processed by use-chat.
    (action as any)._setActivatingMessageId = (id: string | null) => {
      activatingMessageIdRef.current = id;
    };

    // add a handler that will be called when the action is executed
    action.handler = useAsyncCallback(async () => {
      const currentActivatingId = activatingMessageIdRef.current;
      // we create a new promise when the handler is called
      let resolve: (result: any) => void;
      let reject: (error: any) => void;
      const promise = new Promise<any>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      renderAndWaitRef.current = {
        promise,
        resolve: resolve!,
        reject: reject!,
        messageId: currentActivatingId,
      };
      // then we await the promise (it will be resolved in the original renderAndWait function)
      const result = await promise;
      return result;
    }, []) as any;

    // add a render function that will be called when the action is rendered
    action.render = ((props: ActionRenderProps<T> & { messageId?: string }): React.ReactElement => {
      const currentRenderMessageId = props.messageId;
      // For renderAndWaitForResponse, the 'executing' state might be set by use-chat before
      // this specific action instance's handler (and thus its promise) is ready.
      // This logic adjusts the status to 'inProgress' if the current render
      // isn't for the actively processing HITL action, preventing premature interaction.
      let status = props.status;
      if (props.status === "executing") {
        if (!renderAndWaitRef.current || !renderAndWaitRef.current.promise) {
          status = "inProgress";
        } else if (
          renderAndWaitRef.current.messageId !== currentRenderMessageId &&
          activatingMessageIdRef.current !== currentRenderMessageId
        ) {
          status = "inProgress";
        }
        // If conditions met, status remains 'executing'
      }
      // Create type safe waitProps based on whether T extends empty array or not
      const waitProps = {
        status,
        args: props.args,
        result: props.result,
        // handler and respond should only be provided if this is the truly active instance
        // and its promise infrastructure is ready.
        handler:
          status === "executing" &&
          renderAndWaitRef.current &&
          renderAndWaitRef.current.messageId === currentRenderMessageId
            ? renderAndWaitRef.current!.resolve
            : undefined,
        respond:
          status === "executing" &&
          renderAndWaitRef.current &&
          renderAndWaitRef.current.messageId === currentRenderMessageId
            ? renderAndWaitRef.current!.resolve
            : undefined,
      } as T extends [] ? ActionRenderPropsNoArgsWait<T> : ActionRenderPropsWait<T>;

      // Type guard to check if renderAndWait is for no args case
      const isNoArgsRenderWait = (
        _fn:
          | ((props: ActionRenderPropsNoArgsWait<T>) => React.ReactElement)
          | ((props: ActionRenderPropsWait<T>) => React.ReactElement),
      ): _fn is (props: ActionRenderPropsNoArgsWait<T>) => React.ReactElement => {
        return action.parameters?.length === 0;
      };

      // Safely call renderAndWait with correct props type
      if (renderAndWait) {
        if (isNoArgsRenderWait(renderAndWait)) {
          return renderAndWait(waitProps as ActionRenderPropsNoArgsWait<T>);
        } else {
          return renderAndWait(waitProps as ActionRenderPropsWait<T>);
        }
      }

      // Return empty Fragment instead of null
      return createElement(Fragment);
    }) as any;
  }

  // If the developer doesn't provide dependencies, we assume they want to
  // update handler and render function when the action object changes.
  // This ensures that any captured variables in the handler are up to date.
  if (dependencies === undefined) {
    if (actions[idRef.current]) {
      // catch all actions don't have a handler
      if (isFrontendAction(action)) {
        actions[idRef.current].handler = action.handler as any;
      }
      if (typeof action.render === "function") {
        if (chatComponentsCache.current !== null) {
          // TODO: using as any here because the type definitions are getting to tricky
          // not wasting time on this now - we know the types are compatible
          chatComponentsCache.current.actions[action.name] = action.render as any;
        }
      }
    }
  }

  useEffect(() => {
    const hasDuplicate = Object.values(actions).some(
      (otherAction) => otherAction.name === action.name && otherAction !== actions[idRef.current],
    );

    if (hasDuplicate) {
      addToast({
        type: "warning",
        message: `Found an already registered action with name ${action.name}.`,
        id: `dup-action-${action.name}`,
      });
    }
  }, [actions]);

  useEffect(() => {
    setAction(idRef.current, action as any);
    if (chatComponentsCache.current !== null && action.render !== undefined) {
      // see comment about type safety above
      chatComponentsCache.current.actions[action.name] = action.render as any;
    }
    return () => {
      // NOTE: For now, we don't remove the chatComponentsCache entry when the action is removed.
      // This is because we currently don't have access to the messages array in CopilotContext.
      // UPDATE: We now have access, we should remove the entry if not referenced by any message.
      removeAction(idRef.current);
    };
  }, [
    setAction,
    removeAction,
    isFrontendAction(action) ? action.description : undefined,
    action.name,
    isFrontendAction(action) ? action.disabled : undefined,
    isFrontendAction(action) ? action.available : undefined,
    // This should be faster than deep equality checking
    // In addition, all major JS engines guarantee the order of object keys
    JSON.stringify(isFrontendAction(action) ? action.parameters : []),
    // include render only if it's a string
    typeof action.render === "string" ? action.render : undefined,
    // dependencies set by the developer
    ...(dependencies || []),
  ]);
}

function isFrontendAction<T extends Parameter[]>(
  action: FrontendAction<T> | CatchAllFrontendAction,
): action is FrontendAction<T> {
  return action.name !== "*";
}

interface RenderAndWaitForResponse {
  promise: Promise<any>;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  messageId: string | null;
}
