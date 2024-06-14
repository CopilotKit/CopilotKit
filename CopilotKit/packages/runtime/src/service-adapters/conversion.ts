import { ActionExecutionMessage, Message, ResultMessage, TextMessage } from "../graphql/types/converted";
import { MessageInput } from "../graphql/inputs/message.input";
import { plainToInstance } from "class-transformer";

export function convertGqlInputToMessages(inputMessages: MessageInput[]): Message[] {
  const messages: Message[] = [];

  for (const message of inputMessages) {
    if (message.textMessage) {
      messages.push(
        plainToInstance(TextMessage, {
          id: message.id,
          createdAt: message.createdAt,
          role: message.textMessage.role,
          content: message.textMessage.content,
        })
      );
    } else if (message.actionExecutionMessage) {
      messages.push(
        plainToInstance(ActionExecutionMessage, {
          id: message.id,
          createdAt: message.createdAt,
          name: message.actionExecutionMessage.name,
          arguments: JSON.parse(message.actionExecutionMessage.arguments),
          scope: message.actionExecutionMessage.scope,
        }),
      );
    } else if (message.resultMessage) {
      messages.push(
        plainToInstance(ResultMessage, {
          id: message.id,
          createdAt: message.createdAt,
          actionExecutionId: message.resultMessage.actionExecutionId,
          actionName: message.resultMessage.actionName,
          result: message.resultMessage.result,
        }),
      );
    }
  }

  return messages;
}
