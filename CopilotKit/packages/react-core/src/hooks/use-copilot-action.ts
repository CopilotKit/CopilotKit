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
import { ResultMessage, MessageStatusCode } from "@copilotkit/runtime-client-gql";
import { useCopilotMessagesContext } from "../context/copilot-messages-context";
import { ActionExecutionMessage } from "@copilotkit/runtime-client-gql";

// Enhanced interface for our internal tracking
interface RenderAndWaitForResponse {
  promise: Promise<any>;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  messageId: string;
  actionName: string;
  isHandlerPromise?: boolean;
  isUIPromise?: boolean;
  handlerResolveCallback?: (result: any) => void;
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
  const { messages, setMessages } = useCopilotMessagesContext();
  const idRef = useRef<string>(randomId());
  // Use a map to store multiple promises by message ID
  const renderAndWaitMapRef = useRef<Map<string, RenderAndWaitForResponse>>(new Map());
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
    action.handler = useAsyncCallback(async (args, messageId) => {
      console.log(`[${action.name}] renderAndWaitForResponse handler called with messageId:`, messageId);
      
      // Look for existing handler for this messageId if it exists
      if (messageId && renderAndWaitMapRef.current.has(messageId)) {
        console.log(`[${action.name}] Found existing handler for messageId: ${messageId}`);
        const existingPromise = renderAndWaitMapRef.current.get(messageId);
        return existingPromise?.promise;
      }
      
      // we create a new promise when the handler is called
      let resolve: (result: any) => void;
      let reject: (error: any) => void;
      const promise = new Promise<any>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      
      // Use the messageId as the key if available, or generate a fallback ID
      const promiseId = messageId || `fallback-${randomId()}`;
      
      // Store the promise, resolve, and reject functions in the map
      const handler = { 
        promise, 
        resolve: resolve!, 
        reject: reject!,
        messageId: promiseId,
        actionName: action.name,
        isHandlerPromise: true, // Mark this as the handler promise
        handlerResolveCallback: (result: any) => {
          console.log(`[${action.name}] Handler promise resolved for ${promiseId} with:`, result);
          resolve(result);
        }
      };
      
      renderAndWaitMapRef.current.set(promiseId, handler);
      
      console.log(`[${action.name}] Stored promise for messageId: ${promiseId}`);
      console.log(`[${action.name}] Map now contains ${renderAndWaitMapRef.current.size} entries`);
      
      try {
        // await the promise (it will be resolved in the renderAndWait function)
        console.log(`[${action.name}] Awaiting promise resolution for messageId: ${promiseId}`);
        const result = await promise;
        console.log(`[${action.name}] Promise resolved for messageId: ${promiseId} with result:`, result);
        
        // Clean up the map entry after resolution
        renderAndWaitMapRef.current.delete(promiseId);
        console.log(`[${action.name}] Cleaned up promise for messageId: ${promiseId}`);
        console.log(`[${action.name}] Map now contains ${renderAndWaitMapRef.current.size} entries`);
        
        return result;
      } catch (error) {
        console.error(`[${action.name}] Promise rejected for messageId: ${promiseId}`, error);
        // Clean up the map entry after rejection
        renderAndWaitMapRef.current.delete(promiseId);
        console.log(`[${action.name}] Cleaned up rejected promise for messageId: ${promiseId}`);
        throw error;
      }
    }, []) as any;

    // add a render function that will be called when the action is rendered
    action.render = ((props: any): React.ReactElement => {
      // Get the message ID from props.rawData (which should contain the message object)
      const rawData = props.rawData;
      const messageId = rawData?.id;
      
      if (messageId) {
        console.log(`[${action.name}] Render called for messageId: ${messageId}`);
      } else {
        console.log(`[${action.name}] Render called with NO messageId`);
      }
      
      // Determine the current status
      let status = props.status;
      
      // Check if there's a result message for this action execution message
      if (messageId && status !== "complete") {
        const hasResultMessage = messages.some(msg => 
          msg.isResultMessage() && 
          msg.actionExecutionId === messageId &&
          msg.actionName === action.name
        );
        
        if (hasResultMessage) {
          console.log(`[${action.name}] Found result message for ${messageId}, setting status to complete`);
          status = "complete";
        }
      }
      
      // This is a key improvement - we check for the existence of a specific promise 
      // in the map for this message ID
      if (props.status === "executing" && messageId) {
        // If we don't have a handler for this message ID yet, try to register one
        if (!renderAndWaitMapRef.current.has(messageId)) {
          console.log(`[${action.name}] Status is executing but no handler found for messageId: ${messageId}, creating one now`);
          
          // Create a new promise for this message
          let resolve: (result: any) => void;
          let reject: (error: any) => void;
          const promise = new Promise<any>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
          });
          
          // Check if there's a fallback handler promise we need to link to
          const fallbackHandlers = Array.from(renderAndWaitMapRef.current.entries())
            .filter(([key, value]) => 
              key.startsWith('fallback-') && 
              value.actionName === action.name && 
              value.isHandlerPromise);
          
          const customResolve = (result: any) => {
            // Resolve this promise
            resolve(result);
            
            // If we have a fallback handler, also resolve that one
            if (fallbackHandlers.length > 0) {
              const [fallbackKey, fallbackHandler] = fallbackHandlers[0];
              console.log(`[${action.name}] Also resolving fallback handler for ${fallbackKey}`);
              if (fallbackHandler.handlerResolveCallback) {
                fallbackHandler.handlerResolveCallback(result);
              } else {
                console.warn(`[${action.name}] No handlerResolveCallback for ${fallbackKey}`);
              }
            }
            
            // Create and add a result message to the chat messages
            if (messageId) {
              // First check if a result message already exists for this action
              const existingResultMessage = messages.find(msg => 
                msg.isResultMessage() && 
                msg.actionExecutionId === messageId &&
                msg.actionName === action.name
              );
              
              if (!existingResultMessage) {
                const resultMessage = new ResultMessage({
                  id: randomId(),
                  actionExecutionId: messageId,
                  actionName: action.name,
                  result: typeof result === 'string' ? result : JSON.stringify(result),
                  status: { code: MessageStatusCode.Success }
                });
                
                console.log(`[${action.name}] Adding result message for ${messageId}:`, resultMessage);
                
                // Add the result message to the messages array
                setMessages((prevMessages) => {
                  // Find the index of the action execution message
                  const actionIndex = prevMessages.findIndex(msg => msg.id === messageId);
                  if (actionIndex !== -1) {
                    // Insert result message right after action execution message
                    const newMessages = [...prevMessages];
                    newMessages.splice(actionIndex + 1, 0, resultMessage);
                    return newMessages;
                  }
                  return [...prevMessages, resultMessage];
                });
              } else {
                console.log(`[${action.name}] Result message already exists for ${messageId}, skipping`);
              }
              
              // Also update the action execution message status
              setMessages((prevMessages) => {
                return prevMessages.map(msg => {
                  if (msg.id === messageId) {
                    // We need to create a proper copy that maintains the message methods
                    // Instead of modifying the status directly, create a new ActionExecutionMessage
                    if (msg.isActionExecutionMessage()) {
                      return new ActionExecutionMessage({
                        ...msg,
                        id: msg.id,
                        name: msg.name,
                        arguments: msg.arguments,
                        parentMessageId: msg.parentMessageId,
                        createdAt: msg.createdAt,
                        status: { code: MessageStatusCode.Success }
                      });
                    }
                  }
                  return msg;
                });
              });
            }
            
            // Clean up this promise from the map
            renderAndWaitMapRef.current.delete(messageId);
            console.log(`[${action.name}] Cleaned up UI promise for ${messageId}`);
            console.log(`[${action.name}] Map now contains ${renderAndWaitMapRef.current.size} entries`);
          };
          
          renderAndWaitMapRef.current.set(messageId, {
            promise,
            resolve: customResolve,
            reject: reject!,
            messageId: messageId,
            actionName: action.name,
            isUIPromise: true // Mark this as a UI promise
          });
          
          // If we found a fallback handler, log that we linked them
          if (fallbackHandlers.length > 0) {
            const [fallbackKey] = fallbackHandlers[0];
            console.log(`[${action.name}] Linked UI promise ${messageId} to fallback handler ${fallbackKey}`);
          }
          
          console.log(`[${action.name}] Created new promise for messageId: ${messageId}`);
          console.log(`[${action.name}] Map now contains ${renderAndWaitMapRef.current.size} entries`);
        } else {
          console.log(`[${action.name}] Found existing handler for messageId: ${messageId}`);
        }
      }
      
      // Log all promises in the map for debugging
      if (renderAndWaitMapRef.current.size > 0) {
        console.log(`[${action.name}] Current promises in map:`);
        renderAndWaitMapRef.current.forEach((value, key) => {
          console.log(`- ${key} (${value.actionName})${value.isHandlerPromise ? ' [HANDLER]' : ''}${value.isUIPromise ? ' [UI]' : ''}`);
        });
      }
      
      // Create waitProps with message-specific resolve function
      const waitProps = {
        status,
        args: props.args,
        result: props.result,
        rawData, // Pass the raw message data through
        // Use the specific message's resolve function if we have it
        handler: status === "executing" && messageId ? 
          renderAndWaitMapRef.current.get(messageId)?.resolve : undefined,
        respond: status === "executing" && messageId ? 
          renderAndWaitMapRef.current.get(messageId)?.resolve : undefined
      };
      
      if (status === "executing" && messageId) {
        console.log(`[${action.name}] Providing resolve function for messageId: ${messageId}`);
      } else if (status === "complete" && messageId) {
        console.log(`[${action.name}] Status is complete for messageId: ${messageId}`);
      }
      
      // Ensure we remove any promises for completed actions
      if (status === "complete" && messageId && renderAndWaitMapRef.current.has(messageId)) {
        console.log(`[${action.name}] Cleaning up promise for completed action ${messageId}`);
        renderAndWaitMapRef.current.delete(messageId);
      }

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
          return renderAndWait(waitProps as unknown as ActionRenderPropsNoArgsWait<T>);
        } else {
          return renderAndWait(waitProps as unknown as ActionRenderPropsWait<T>);
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
