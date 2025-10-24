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
import { useEffect } from "react";
import { Parameter } from "@copilotkit/shared";
import { CatchAllFrontendAction, FrontendAction } from "../types/frontend-action";
import { useFrontendTool, UseFrontendToolArgs } from "./use-frontend-tool";
import { useBackendToolCall, UseBackendToolCallArgs } from "./use-backend-tool-call";
import { useHumanInTheLoop, UseHumanInTheLoopArgs } from "./use-human-in-the-loop";
import { useCopilotContext } from "../context";

// Component wrappers that call hooks - these allow React to properly manage hook state
// even when action types change between renders
function BackendToolCallComponent<T extends Parameter[] | [] = []>({
  action,
}: {
  action: UseBackendToolCallArgs<T>;
}) {
  useBackendToolCall(action);
  return null;
}

function HumanInTheLoopComponent<T extends Parameter[] | [] = []>({
  action,
}: {
  action: UseHumanInTheLoopArgs<T>;
}) {
  useHumanInTheLoop(action);
  return null;
}

function FrontendToolComponent<T extends Parameter[] | [] = []>({
  action,
}: {
  action: UseFrontendToolArgs<T>;
}) {
  useFrontendTool(action);
  return null;
}

// Helper to determine which component and action config to use
function getActionConfig<const T extends Parameter[] | [] = []>(
  action: FrontendAction<T> | CatchAllFrontendAction,
) {
  if (action.name === "*") {
    return {
      type: "render" as const,
      action: action as UseBackendToolCallArgs<T>,
      component: BackendToolCallComponent,
    };
  }

  if ("renderAndWaitForResponse" in action || "renderAndWait" in action) {
    let render = action.render;
    if (!render && "renderAndWaitForResponse" in action) {
      // @ts-expect-error -- renderAndWaitForResponse is deprecated, but we need to support it for backwards compatibility
      render = action.renderAndWaitForResponse;
    }
    if (!render && "renderAndWait" in action) {
      // @ts-expect-error -- renderAndWait is deprecated, but we need to support it for backwards compatibility
      render = action.renderAndWait;
    }
    return {
      type: "hitl" as const,
      action: { ...action, render } as UseHumanInTheLoopArgs<T>,
      component: HumanInTheLoopComponent,
    };
  }

  if ("available" in action) {
    if (action.available === "enabled" || action.available === "remote") {
      return {
        type: "frontend" as const,
        action: action as UseFrontendToolArgs<T>,
        component: FrontendToolComponent,
      };
    }
    if (action.available === "frontend" || action.available === "disabled") {
      return {
        type: "render" as const,
        action: action as UseBackendToolCallArgs<T>,
        component: BackendToolCallComponent,
      };
    }
  }

  if ("handler" in action) {
    return {
      type: "frontend" as const,
      action: action as UseFrontendToolArgs<T>,
      component: FrontendToolComponent,
    };
  }

  throw new Error("Invalid action configuration");
}

/**
 * useCopilotAction is a legacy hook maintained for backwards compatibility.
 *
 * To avoid violating React's Rules of Hooks (which prohibit conditional hook calls),
 * we use a registration pattern:
 * 1. This hook registers the action configuration with the CopilotContext
 * 2. A renderer component in CopilotKit actually renders the appropriate hook wrapper
 * 3. React properly manages hook state since components are rendered, not conditionally called
 *
 * This allows action types to change between renders without corrupting React's hook state.
 */
export function useCopilotAction<const T extends Parameter[] | [] = []>(
  action: FrontendAction<T> | CatchAllFrontendAction,
  dependencies?: any[],
): void {
  const { setRegisteredActions, removeRegisteredAction } = useCopilotContext();

  // Register the action with context after render to avoid setState-in-render errors
  useEffect(() => {
    const actionConfig = getActionConfig(action);
    const actionKey = setRegisteredActions(actionConfig);

    // Cleanup: Remove the action when component unmounts or dependencies change
    return () => {
      removeRegisteredAction(actionKey);
    };
  }, [...(dependencies ?? []), JSON.stringify(action)]);
}
