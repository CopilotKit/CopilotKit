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
 * <img src="/images/use-copilot-action/useCopilotAction.gif" width="500" />
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

// Define a data structure to hold the current active renderAndWait action
// Using a shared singleton pattern that works across component instances
interface RenderAndWaitForResponse {
  promise: Promise<any>;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  actionName: string;
  args: any;
  actionId: string;
}

// Static reference for the current active renderAndWait action
// This will be null when no action is awaiting resolution
let activeRenderAndWait: RenderAndWaitForResponse | null = null;

// Keep a list of pending actions to process sequentially
let pendingRenderAndWaitActions: string[] = [];

// Add a helper function to check if the global state is available for a new action
function isGlobalStateAvailable(): boolean {
  return activeRenderAndWait === null;
}

// Check if an action is next in line to be executed
function isNextInLine(actionId: string): boolean {
  return pendingRenderAndWaitActions.length === 0 || pendingRenderAndWaitActions[0] === actionId;
}

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
  const { addToast } = useToast();

  // Set up a listener for processing the next action in queue
  useEffect(() => {
    const processNextAction = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { nextActionId } = customEvent.detail || {};
      
      // Check if this action is the next one to be processed
      if (nextActionId === idRef.current && isGlobalStateAvailable()) {
        // Remove this action from the queue if it's there
        pendingRenderAndWaitActions = pendingRenderAndWaitActions.filter(id => id !== idRef.current);
      }
    };
    
    document.addEventListener('copilotkit:process-next-action', processNextAction);
    
    return () => {
      document.removeEventListener('copilotkit:process-next-action', processNextAction);
    };
  }, []);

  // clone the action to avoid mutating the original object
  action = { ...action };

  // If the developer provides a renderAndWaitForResponse function, we transform the action
  // to use a promise internally, so that we can treat it like a normal action.
  if (
    // renderAndWaitForResponse is not available for catch all actions
    isFrontendAction(action) &&
    // check if renderAndWaitForResponse is set
    (action.renderAndWait || action.renderAndWaitForResponse)
  ) {
    const renderAndWait = action.renderAndWait || action.renderAndWaitForResponse;
    // remove the renderAndWait function from the action
    action.renderAndWait = undefined;
    action.renderAndWaitForResponse = undefined;
    // add a handler that will be called when the action is executed
    action.handler = useAsyncCallback(async (args: any) => {
      // Check if there's already an active renderAndWait action
      if (!isGlobalStateAvailable()) {
        // Add this action to the pending queue if not already there
        if (!pendingRenderAndWaitActions.includes(idRef.current)) {
          pendingRenderAndWaitActions.push(idRef.current);
        }
        
        return Promise.reject(
          new Error(`Cannot execute multiple renderAndWait actions simultaneously. Action "${activeRenderAndWait?.actionName}" is already active.`)
        );
      }
      
      // If we're here, we can execute this action
      // Remove it from the queue if it's there
      pendingRenderAndWaitActions = pendingRenderAndWaitActions.filter(id => id !== idRef.current);
      
      // we create a new promise when the handler is called
      let resolve: (result: any) => void;
      let reject: (error: any) => void;
      const promise = new Promise<any>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      
      // Store the action and resolver in the static variable
      activeRenderAndWait = { 
        promise, 
        resolve: (result: any) => {
          // When this action resolves, activate the next one in the queue if available
          resolve!(result);
          activeRenderAndWait = null;
          
          // Process the next queued action after a small delay
          if (pendingRenderAndWaitActions.length > 0) {
            const nextActionId = pendingRenderAndWaitActions[0];
            
            // Small delay to ensure state is updated before processing next action
            setTimeout(() => {
              // The next action in queue will be processed when its handler is called again
              document.dispatchEvent(new CustomEvent('copilotkit:process-next-action', { 
                detail: { nextActionId } 
              }));
            }, 50);
          }
        }, 
        reject: (error: any) => {
          // Handle rejection and advance queue
          reject!(error);
          activeRenderAndWait = null;
          
          // Process the next queued action after a small delay
          if (pendingRenderAndWaitActions.length > 0) {
            const nextActionId = pendingRenderAndWaitActions[0];
            
            // Small delay to ensure state is updated before processing next action
            setTimeout(() => {
              // The next action in queue will be processed when its handler is called again
              document.dispatchEvent(new CustomEvent('copilotkit:process-next-action', { 
                detail: { nextActionId } 
              }));
            }, 50);
          }
        },
        actionName: action.name,
        args,
        actionId: idRef.current 
      };
      
      try {
        // await the promise (it will be resolved in the original renderAndWait function)
        const result = await promise;
        // Clear the global reference when done
        if (activeRenderAndWait?.actionId === idRef.current) {
          activeRenderAndWait = null;
        }
        return result;
      } catch (error) {
        // Clear the global reference on error too
        if (activeRenderAndWait?.actionId === idRef.current) {
          activeRenderAndWait = null;
        }
        throw error;
      }
    }, []) as any;

    // add a render function that will be called when the action is rendered
    action.render = ((props: ActionRenderProps<T>): React.ReactElement => {
      // Check if this specific action instance is awaiting resolution
      const isActiveAction = activeRenderAndWait?.actionId === idRef.current;
      
      // Get the position in queue (0 = active, 1 = next in line, etc.)
      const queuePosition = isActiveAction ? 0 : pendingRenderAndWaitActions.indexOf(idRef.current) + 1;
      
      // If this action is executing but not the active one, don't render it at all
      // This is critical to prevent multiple HITL actions from appearing at once
      if (props.status === "executing" && !isActiveAction) {
        return createElement(Fragment);
      }
      
      // Only show executing state if this action is the active one
      let status = props.status;
      if (props.status === "executing" && !isActiveAction) {
        status = "inProgress";
      }
      
      // Create type safe waitProps based on whether T extends empty array or not
      const waitProps = {
        status,
        args: props.args,
        result: props.result,
        handler: status === "executing" && isActiveAction ? activeRenderAndWait?.resolve : undefined,
        respond: status === "executing" && isActiveAction ? activeRenderAndWait?.resolve : undefined,
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
