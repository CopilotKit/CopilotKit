import {
  ActionExecutionMessage,
  Message,
  ResultMessage,
  TextMessage,
} from "../../graphql/types/converted";
import { Tool } from "@google/generative-ai";
import { ActionInput } from "../../graphql/inputs/action.input";

export function convertMessageToGoogleGenAIMessage(message: Message) {
  if (message instanceof TextMessage) {
    const role = {
      user: "user",
      assistant: "model",
      system: "user",
    }[message.role];

    const text =
      message.role === "system"
        ? "THE FOLLOWING MESSAGE IS A SYSTEM MESSAGE: " + message.content
        : message.content;

    return {
      role,
      parts: [{ text }],
    };
  } else if (message instanceof ActionExecutionMessage) {
    return {
      role: "model",
      parts: [
        {
          functionCall: {
            name: message.name,
            args: message.arguments,
          },
        },
      ],
    };
  } else if (message instanceof ResultMessage) {
    return {
      role: "function",
      parts: [
        {
          functionResponse: {
            name: message.actionName,
            response: {
              name: message.actionName,
              content: tryParseJson(message.result),
            },
          },
        },
      ],
    };
  }
}

export function transformActionToGoogleGenAITool(action: ActionInput): Tool {
  const name = action.name;
  const description = action.description;
  const parameters = JSON.parse(action.jsonSchema);

  const transformProperties = (props: any) => {
    for (const key in props) {
      if (props[key].type) {
        props[key].type = props[key].type.toUpperCase();
      }
      if (props[key].properties) {
        transformProperties(props[key].properties);
      }
    }
  };
  transformProperties(parameters);

  return {
    functionDeclarations: [
      {
        name,
        description,
        parameters,
      },
    ],
  };
}

function tryParseJson(str?: string) {
  if (!str) {
    return "";
  }
  try {
    return JSON.parse(str);
  } catch (e) {
    return str;
  }
}
