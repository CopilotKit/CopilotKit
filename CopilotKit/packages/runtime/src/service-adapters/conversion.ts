import { ActionExecutionMessage, Message, ResultMessage, TextMessage } from "@copilotkit/shared";
import { MessageInput } from "../graphql/inputs/message.input";

export function convertGqlInputToMessages(inputMessages: MessageInput[]): Message[] {
  const messages: Message[] = [];

  for (const message of inputMessages) {
    if (message.textMessage) {
      messages.push(
        new TextMessage({
          id: message.id,
          createdAt: message.createdAt,
          role: message.textMessage.role,
          content: message.textMessage.content,
        }),
      );
    } else if (message.actionExecutionMessage) {
      messages.push(
        new ActionExecutionMessage({
          id: message.id,
          createdAt: message.createdAt,
          name: message.actionExecutionMessage.name,
          arguments: JSON.parse(message.actionExecutionMessage.arguments),
          scope: message.actionExecutionMessage.scope,
        }),
      );
    } else if (message.resultMessage) {
      messages.push(
        new ResultMessage({
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
