import { ActionInput } from "../../graphql/inputs/action.input";
import { ActionExecutionMessage, Message as CopilotMessage, ResultMessage, TextMessage } from "../../graphql/types/converted";
import { ChatCompletionsBodyStreaming } from "portkey-ai/dist/src/apis/chatCompletions";

export function convertMessageToPortkeyMessage(message: CopilotMessage): ChatCompletionsBodyStreaming['messages'][0] {
    if (message instanceof TextMessage) {
        return {
            role: message.role,
            content: message.content,
        }
    } else if (message instanceof ActionExecutionMessage) {
        return {
            role: "assistant",
            tool_calls: [   
                {
                    id: message.id,
                    type: "function",
                    function: {
                        name: message.name,
                        arguments: JSON.stringify(message.arguments),
                    }
                }
            ],
            content: ""
        }
    } else if (message instanceof ResultMessage) {
        return {
          role: "tool",
          content: message.result,
          // @ts-ignore
          tool_call_id: message.actionExecutionId,
        };
      }
}

export function convertActionInputToPortkeyTool(action: ActionInput) {
    return {
      type: "function",
      function: {
        name: action.name,
        description: action.description,
        parameters: JSON.parse(action.jsonSchema),
      },
    };
}