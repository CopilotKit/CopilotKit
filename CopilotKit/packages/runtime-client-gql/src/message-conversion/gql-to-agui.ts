import * as gql from "../client";
import agui from "@copilotkit/shared";
import { MessageStatusCode } from "../graphql/@generated/graphql";

// Define valid image formats based on the supported formats in the codebase
const VALID_IMAGE_FORMATS = ["jpeg", "png", "webp", "gif"] as const;
type ValidImageFormat = (typeof VALID_IMAGE_FORMATS)[number];

// Validation function for image format
function validateImageFormat(format: string): format is ValidImageFormat {
  return VALID_IMAGE_FORMATS.includes(format as ValidImageFormat);
}

/*
  ----------------------------
  GQL Message -> AGUI Message
  ----------------------------
*/
export function gqlToAGUI(
  messages: gql.Message[] | gql.Message,
  actions?: Record<string, any>,
  coAgentStateRenders?: Record<string, any>,
): agui.Message[] {
  let aguiMessages: agui.Message[] = [];
  messages = Array.isArray(messages) ? messages : [messages];

  // Create a map of action execution ID to result for completed actions
  const actionResults = new Map<string, string>();
  for (const message of messages) {
    if (message.isResultMessage()) {
      actionResults.set(message.actionExecutionId, message.result);
    }
  }

  for (const message of messages) {
    if (message.isTextMessage()) {
      aguiMessages.push(gqlTextMessageToAGUIMessage(message));
    } else if (message.isResultMessage()) {
      aguiMessages.push(gqlResultMessageToAGUIMessage(message));
    } else if (message.isActionExecutionMessage()) {
      aguiMessages.push(gqlActionExecutionMessageToAGUIMessage(message, actions, actionResults));
    } else if (message.isAgentStateMessage()) {
      aguiMessages.push(gqlAgentStateMessageToAGUIMessage(message, coAgentStateRenders));
    } else if (message.isImageMessage()) {
      aguiMessages.push(gqlImageMessageToAGUIMessage(message));
    } else {
      throw new Error("Unknown message type");
    }
  }

  return aguiMessages;
}

function gqlActionExecutionMessageToAGUIMessage(
  message: gql.ActionExecutionMessage,
  actions?: Record<string, any>,
  actionResults?: Map<string, string>,
): agui.Message {
  if (actions && Object.values(actions).some((action: any) => action.name === message.name)) {
    const action = Object.values(actions).find((action: any) => action.name === message.name);

    // Create render function wrapper that provides proper props
    const createRenderWrapper = (originalRender: any) => {
      if (!originalRender) return undefined;

      return (props?: any) => {
        // Determine the correct status based on the same logic as RenderActionExecutionMessage
        const actionResult = actionResults?.get(message.id);
        let status: "inProgress" | "executing" | "complete" = "inProgress";

        if (actionResult !== undefined) {
          status = "complete";
        } else if (message.status?.code !== MessageStatusCode.Pending) {
          status = "executing";
        }

        // Provide the full props structure that the render function expects
        const renderProps = {
          status: props?.status || status,
          args: message.arguments || {},
          result: props?.result || actionResult || undefined,
          respond: props?.respond || (() => {}),
          messageId: message.id,
          ...props,
        };

        return originalRender(renderProps);
      };
    };

    return {
      id: message.id,
      role: "assistant",
      content: "",
      toolCalls: [actionExecutionMessageToAGUIMessage(message)],
      generativeUI: createRenderWrapper(action.render),
      name: message.name,
    } as agui.AIMessage;
  }

  return {
    id: message.id,
    role: "assistant",
    toolCalls: [actionExecutionMessageToAGUIMessage(message)],
    name: message.name,
  };
}

function gqlAgentStateMessageToAGUIMessage(
  message: gql.AgentStateMessage,
  coAgentStateRenders?: Record<string, any>,
): agui.Message {
  if (
    coAgentStateRenders &&
    Object.values(coAgentStateRenders).some((render: any) => render.name === message.agentName)
  ) {
    const render = Object.values(coAgentStateRenders).find(
      (render: any) => render.name === message.agentName,
    );

    // Create render function wrapper that provides proper props
    const createRenderWrapper = (originalRender: any) => {
      if (!originalRender) return undefined;

      return (props?: any) => {
        // Determine the correct status based on the same logic as RenderActionExecutionMessage
        const state = message.state;

        // Provide the full props structure that the render function expects
        const renderProps = {
          state: state,
        };

        return originalRender(renderProps);
      };
    };

    return {
      id: message.id,
      role: "assistant",
      generativeUI: createRenderWrapper(render.render),
      agentName: message.agentName,
      state: message.state,
    };
  }

  return {
    id: message.id,
    role: "assistant",
    agentName: message.agentName,
    state: message.state,
  };
}

function actionExecutionMessageToAGUIMessage(
  actionExecutionMessage: gql.ActionExecutionMessage,
): agui.ToolCall {
  return {
    id: actionExecutionMessage.id,
    function: {
      name: actionExecutionMessage.name,
      arguments: JSON.stringify(actionExecutionMessage.arguments),
    },
    type: "function",
  };
}

export function gqlTextMessageToAGUIMessage(message: gql.TextMessage): agui.Message {
  switch (message.role) {
    case gql.Role.Developer:
      return {
        id: message.id,
        role: "developer",
        content: message.content,
      };
    case gql.Role.System:
      return {
        id: message.id,
        role: "system",
        content: message.content,
      };
    case gql.Role.Assistant:
      return {
        id: message.id,
        role: "assistant",
        content: message.content,
      };
    case gql.Role.User:
      return {
        id: message.id,
        role: "user",
        content: message.content,
      };
    default:
      throw new Error("Unknown message role");
  }
}

export function gqlResultMessageToAGUIMessage(message: gql.ResultMessage): agui.Message {
  return {
    id: message.id,
    role: "tool",
    content: message.result,
    toolCallId: message.actionExecutionId,
    toolName: message.actionName,
  };
}

export function gqlImageMessageToAGUIMessage(message: gql.ImageMessage): agui.Message {
  // Validate image format
  if (!validateImageFormat(message.format)) {
    throw new Error(
      `Invalid image format: ${message.format}. Supported formats are: ${VALID_IMAGE_FORMATS.join(", ")}`,
    );
  }

  // Validate that bytes is a non-empty string
  if (!message.bytes || typeof message.bytes !== "string" || message.bytes.trim() === "") {
    throw new Error("Image bytes must be a non-empty string");
  }

  // Determine the role based on the message role
  const role = message.role === gql.Role.Assistant ? "assistant" : "user";

  // Create the image message with proper typing
  const imageMessage: agui.Message = {
    id: message.id,
    role,
    content: "",
    image: {
      format: message.format,
      bytes: message.bytes,
    },
  };

  return imageMessage;
}
