import {
  ActionExecutionMessage,
  Message,
  ResultMessage,
  TextMessage,
  AgentStateMessage,
} from "../graphql/types/converted";
import { MessageInput } from "../graphql/inputs/message.input";
import { plainToInstance } from "class-transformer";
import { parseJson } from "@copilotkit/shared";

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
          parentMessageId: message.textMessage.parentMessageId,
        }),
      );
    } else if (message.actionExecutionMessage) {
      messages.push(
        plainToInstance(ActionExecutionMessage, {
          id: message.id,
          createdAt: message.createdAt,
          name: message.actionExecutionMessage.name,
          arguments: parseJson(message.actionExecutionMessage.arguments, {}),
          parentMessageId: message.actionExecutionMessage.parentMessageId,
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
    } else if (message.agentStateMessage) {
      messages.push(
        plainToInstance(AgentStateMessage, {
          id: message.id,
          threadId: message.agentStateMessage.threadId,
          createdAt: message.createdAt,
          agentName: message.agentStateMessage.agentName,
          nodeName: message.agentStateMessage.nodeName,
          runId: message.agentStateMessage.runId,
          active: message.agentStateMessage.active,
          role: message.agentStateMessage.role,
          state: parseJson(message.agentStateMessage.state, {}),
          running: message.agentStateMessage.running,
        }),
      );
    }
  }

  return messages;
}
