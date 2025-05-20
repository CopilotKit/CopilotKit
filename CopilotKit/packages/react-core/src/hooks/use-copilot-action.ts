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

// Better tracking for in-progress actions
const pendingHitlPromises = new Map<string, RenderAndWaitForResponse>();
const messageIdToActionIdMap = new Map<string, string>();
const actionNameToActiveMessageIds = new Map<string, Set<string>>();
const completedMessageIds = new Set<string>(); // Track message IDs that have completed execution

// Add a method to clean up stale promises
function cleanupStalePromises() {
  const now = Date.now();
  const staleTimeout = 5 * 60 * 1000; // 5 minutes
  
  for (const [id, promise] of pendingHitlPromises.entries()) {
    if (promise.timestamp && now - promise.timestamp > staleTimeout) {
      // Clean up any message ID mappings for this action ID
      for (const [msgId, actId] of messageIdToActionIdMap.entries()) {
        if (actId === id) {
          messageIdToActionIdMap.delete(msgId);
        }
      }
      
      // Remove from action name tracking
      if (promise.actionName) {
        const activeMessages = actionNameToActiveMessageIds.get(promise.actionName);
        if (activeMessages) {
          for (const msgId of activeMessages) {
            if (messageIdToActionIdMap.get(msgId) === id) {
              activeMessages.delete(msgId);
            }
          }
          if (activeMessages.size === 0) {
            actionNameToActiveMessageIds.delete(promise.actionName);
          }
        }
      }
      
      // Remove the promise itself
      pendingHitlPromises.delete(id);
    }
  }
}

// Add a function to clean up promises for a specific message ID
function cleanupPromiseByMessageId(messageId: string) {
  if (!messageId) return;
  
  // Mark this message as completed
  completedMessageIds.add(messageId);
  
  const actionExecutionId = messageIdToActionIdMap.get(messageId);
  if (actionExecutionId) {
    const promise = pendingHitlPromises.get(actionExecutionId);
    
    if (promise) {
      // Get the action name for action name tracking cleanup
      const actionName = promise.actionName;
      
      // Delete the promise from the map
      pendingHitlPromises.delete(actionExecutionId);
      
      // Clear the message ID mapping
      messageIdToActionIdMap.delete(messageId);
      
      // Clean up from action name tracking
      if (actionName) {
        const activeMessages = actionNameToActiveMessageIds.get(actionName);
        if (activeMessages) {
          activeMessages.delete(messageId);
          if (activeMessages.size === 0) {
            actionNameToActiveMessageIds.delete(actionName);
          }
        }
      }
    }
  }
}

// Periodically clean up stale promises (every minute)
if (typeof window !== 'undefined') {
  setInterval(cleanupStalePromises, 60 * 1000);
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
    action.handler = useAsyncCallback(async (...args: any[]) => {
      // Clean up any stale promises first
      cleanupStalePromises();
      
      // Generate a unique ID for this specific action execution instance
      const actionExecutionId = `${action.name}-${randomId()}`;
      
      // Check for current action message ID from the global variable
      // This is populated by the executeAction function in use-chat.ts
      const currentActionMessageId = (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__;
      const currentActionName = (window as any).__COPILOT_CURRENT_ACTION_NAME__;
      
      // Check for existing promises for this exact message ID
      let existingPromiseId = messageIdToActionIdMap.get(currentActionMessageId || "");
      let existingPromise = existingPromiseId ? pendingHitlPromises.get(existingPromiseId) : undefined;
      
      if (existingPromise && existingPromise.actionName === action.name) {
        // Return the existing promise - this prevents duplicate executions
        return existingPromise.promise;
      }
      
      // Check for any existing promises for this action that might be in conflict
      const existingPromises = Array.from(pendingHitlPromises.values())
        .filter(p => p.actionName === action.name);
        
      // First check if this message has already been completed
      if (currentActionMessageId && completedMessageIds.has(currentActionMessageId)) {
        // Return a resolved promise to prevent hanging
        return Promise.resolve("");
      }
      
      // we create a new promise when the handler is called
      let resolve: (result: any) => void;
      let reject: (error: any) => void;
      const promise = new Promise<any>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      
      // Store the promise in the global map using the generated ID
      pendingHitlPromises.set(actionExecutionId, { 
        promise, 
        resolve: resolve!, 
        reject: reject!,
        actionName: action.name,
        actionExecutionId,
        timestamp: Date.now(),
        messageId: currentActionMessageId 
      });
      
      // Track this message ID for this action name
      if (currentActionMessageId) {
        let activeMessages = actionNameToActiveMessageIds.get(action.name);
        if (!activeMessages) {
          activeMessages = new Set();
          actionNameToActiveMessageIds.set(action.name, activeMessages);
        }
        activeMessages.add(currentActionMessageId);
      }
      
      // Add better handling for promise resolution
      const safeResolve = (result: any) => {
        // First check if this promise is still tracked in the global map
        if (pendingHitlPromises.has(actionExecutionId)) {
          resolve!(result);
          
          // Clean up after a small delay to ensure all render cycles complete
          setTimeout(() => {
            if (pendingHitlPromises.has(actionExecutionId)) {
              pendingHitlPromises.delete(actionExecutionId);
              
              // Also clean up any message ID mapping to this action ID
              for (const [msgId, actId] of messageIdToActionIdMap.entries()) {
                if (actId === actionExecutionId) {
                  messageIdToActionIdMap.delete(msgId);
                  
                  // Clean up from action name tracking
                  const activeMessages = actionNameToActiveMessageIds.get(action.name);
                  if (activeMessages) {
                    activeMessages.delete(msgId);
                    if (activeMessages.size === 0) {
                      actionNameToActiveMessageIds.delete(action.name);
                    }
                  }
                  
                  // Mark this message as completed
                  if (msgId) {
                    completedMessageIds.add(msgId);
                  }
                }
              }
            }
          }, 100);
        } else {
          resolve!(result);
        }
      };
      
      // Replace the original resolve with our safe version
      pendingHitlPromises.get(actionExecutionId)!.resolve = safeResolve;
      
      // Immediately map the message ID to this action execution ID
      // This is critical for async handling when multiple HITL actions are executed together
      if (currentActionMessageId) {
        messageIdToActionIdMap.set(currentActionMessageId, actionExecutionId);
      } else {
        // Try to directly map this execution ID to a message ID
        try {
          // Find a message in the DOM with this action name that has 'executing' status
          const actionMessages = document.querySelectorAll(`[data-message-role="action-render"]`);
          let messageId = null;
          
          for (const msgElement of Array.from(actionMessages)) {
            // Check for data attribute or other indicators that this is our action
            const actionName = msgElement.getAttribute('data-action-name');
            const messageIdAttr = msgElement.getAttribute('data-message-id');
            const statusAttr = msgElement.getAttribute('data-status');
            
            if (actionName === action.name && messageIdAttr && statusAttr === 'executing') {
              messageId = messageIdAttr;
              break;
            }
          }
          
          if (messageId && !messageIdToActionIdMap.has(messageId)) {
            messageIdToActionIdMap.set(messageId, actionExecutionId);
            
            // Update our promise with this message ID
            const promise = pendingHitlPromises.get(actionExecutionId);
            if (promise) {
              promise.messageId = messageId;
            }
            
            // Track this message ID for this action name
            let activeMessages = actionNameToActiveMessageIds.get(action.name);
            if (!activeMessages) {
              activeMessages = new Set();
              actionNameToActiveMessageIds.set(action.name, activeMessages);
            }
            activeMessages.add(messageId);
          }
        } catch (e) {
          // Ignore errors in this fallback logic
        }
      }
      
      // then we await the promise (it will be resolved in the original renderAndWait function)
      try {
        const result = await promise;
        
        // Mark the message as completed
        if (currentActionMessageId) {
          completedMessageIds.add(currentActionMessageId);
        }
        
        return result;
      } catch (error) {
        throw error;
      } finally {
        // Clear the references after the promise is resolved or rejected
        // Note: This might already be cleared by safeResolve, but we do it again as a safety measure
        if (pendingHitlPromises.has(actionExecutionId)) {
          pendingHitlPromises.delete(actionExecutionId);
          
          // Also clean up any message ID mapping to this action ID
          const msgIdToCleanup = [];
          for (const [msgId, actId] of messageIdToActionIdMap.entries()) {
            if (actId === actionExecutionId) {
              msgIdToCleanup.push(msgId);
            }
          }
          
          // Clean up after collecting to avoid modifying while iterating
          for (const msgId of msgIdToCleanup) {
            messageIdToActionIdMap.delete(msgId);
            
            // Clean up from action name tracking
            const activeMessages = actionNameToActiveMessageIds.get(action.name);
            if (activeMessages) {
              activeMessages.delete(msgId);
              if (activeMessages.size === 0) {
                actionNameToActiveMessageIds.delete(action.name);
              }
            }
            
            // Mark this message as completed
            if (msgId) {
              completedMessageIds.add(msgId);
            }
          }
        }
      }
    }, []) as any;

    // add a render function that will be called when the action is rendered
    action.render = ((props: ActionRenderProps<T>): React.ReactElement => {
      // Find the appropriate promise for this action execution
      // In RenderActionExecutionMessage, we pass the message.id as actionId
      const messageId = (props as any).actionId;
      
      // Find the corresponding pending promise for this specific execution
      let pendingPromise: RenderAndWaitForResponse | undefined;
      
      // First check if we have a mapping from this message ID to an action execution ID
      if (messageId) {
        const actionExecutionId = messageIdToActionIdMap.get(messageId);
        if (actionExecutionId) {
          pendingPromise = pendingHitlPromises.get(actionExecutionId);
           
          if (!pendingPromise) {
            // If we're in complete or inProgress state, we can safely remove the stale mapping
            if (props.status !== "executing") {
              messageIdToActionIdMap.delete(messageId);
              
              // Clean up from action name tracking
              const activeMessages = actionNameToActiveMessageIds.get(action.name);
              if (activeMessages) {
                activeMessages.delete(messageId);
                if (activeMessages.size === 0) {
                  actionNameToActiveMessageIds.delete(action.name);
                }
              }
            }
          } else {
            // If we found a promise, ensure it's the correct type
            if (pendingPromise.actionName !== action.name) {
              pendingPromise = undefined;
            }
          }
        }
      }
      
      // If we don't have a mapping or the promise was not found, try to find by action name and status
      if (!pendingPromise && props.status === "executing") {
        // Look for any promises for this action where the message ID matches or isn't set
        const matchingPromises = Array.from(pendingHitlPromises.values())
          .filter(p => p.actionName === action.name && (!p.messageId || p.messageId === messageId));
          
        if (matchingPromises.length > 0) {
          // Sort by timestamp (oldest first) and take the first one
          matchingPromises.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          pendingPromise = matchingPromises[0];
          
          // Update the message ID association if needed
          if (messageId && pendingPromise.actionExecutionId && !pendingPromise.messageId) {
            pendingPromise.messageId = messageId;
            messageIdToActionIdMap.set(messageId, pendingPromise.actionExecutionId);
            
            // Track this message ID for this action name
            let activeMessages = actionNameToActiveMessageIds.get(action.name);
            if (!activeMessages) {
              activeMessages = new Set();
              actionNameToActiveMessageIds.set(action.name, activeMessages);
            }
            activeMessages.add(messageId);
          }
        } else if (messageId) {
          // Special case: If we're in executing state but no promise is found,
          // we might need to create a new promise for this message
          const newActionExecutionId = `${action.name}-${randomId()}`;
          
          let resolve: (result: any) => void;
          let reject: (error: any) => void;
          const promise = new Promise<any>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
          });
          
          // Add the safe resolve function
          const safeResolve = (result: any) => {
            if (pendingHitlPromises.has(newActionExecutionId)) {
              resolve!(result);
              
              // Cleanup after a small delay
              setTimeout(() => {
                if (pendingHitlPromises.has(newActionExecutionId)) {
                  pendingHitlPromises.delete(newActionExecutionId);
                  
                  for (const [msgId, actId] of messageIdToActionIdMap.entries()) {
                    if (actId === newActionExecutionId) {
                      messageIdToActionIdMap.delete(msgId);
                      
                      // Clean up from action name tracking
                      const activeMessages = actionNameToActiveMessageIds.get(action.name);
                      if (activeMessages) {
                        activeMessages.delete(msgId);
                        if (activeMessages.size === 0) {
                          actionNameToActiveMessageIds.delete(action.name);
                        }
                      }
                    }
                  }
                }
              }, 100);
            } else {
              resolve!(result);
            }
          };
          
          pendingPromise = {
            promise,
            resolve: safeResolve,
            reject: reject!,
            actionName: action.name,
            actionExecutionId: newActionExecutionId,
            timestamp: Date.now(),
            messageId
          };
          
          pendingHitlPromises.set(newActionExecutionId, pendingPromise);
          messageIdToActionIdMap.set(messageId, newActionExecutionId);
          
          // Track this message ID for this action name
          let activeMessages = actionNameToActiveMessageIds.get(action.name);
          if (!activeMessages) {
            activeMessages = new Set();
            actionNameToActiveMessageIds.set(action.name, activeMessages);
          }
          activeMessages.add(messageId);
        }
      }
      
      // Add this check to detect stale executing states for regular actions
      // specifically targeting non-HITL actions that might still show executing status
      // but actually have a result
      if (props.status === "executing" && props.result !== undefined) {
        // Use type assertion to update the status while maintaining TypeScript compatibility
        (props as any).status = "complete";
      }
      
      // Specifically for renderAndWaitForResponse the executing state is set too early, causing a race condition
      // To fix it: we will wait for a promise to be ready for this specific action execution
      let status = props.status;
      if (props.status === "executing" && !pendingPromise) {
        status = "inProgress";
      }
       
      // If we're in complete state, make sure to clean up any lingering promises for this action/message
      if (props.status === "complete" && messageId) {
        // Mark this message as completed so we don't create new promises for it
        completedMessageIds.add(messageId);
        
        // Do the normal cleanup
        const actionExecutionId = messageIdToActionIdMap.get(messageId);
        if (actionExecutionId && pendingHitlPromises.has(actionExecutionId)) {
          // Clean up the promise and mappings
          cleanupPromiseByMessageId(messageId);
        } else if (actionExecutionId) {
          // Promise is already gone but mapping still exists
          messageIdToActionIdMap.delete(messageId);
          
          // Clean up from action name tracking
          const activeMessages = actionNameToActiveMessageIds.get(action.name);
          if (activeMessages) {
            activeMessages.delete(messageId);
            if (activeMessages.size === 0) {
              actionNameToActiveMessageIds.delete(action.name);
            }
          }
        }
      }
      
      // Create type safe waitProps based on whether T extends empty array or not
      const waitProps = {
        status,
        args: props.args,
        result: props.result,
        handler: status === "executing" && pendingPromise ? pendingPromise.resolve : undefined,
        respond: status === "executing" && pendingPromise ? pendingPromise.resolve : undefined,
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
  actionName?: string;
  actionExecutionId?: string;
  timestamp?: number;
  messageId?: string;
}
