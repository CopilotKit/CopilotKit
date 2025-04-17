import {
  ActionExecutionMessage,
  Message,
  ResultMessage,
  TextMessage,
  AgentStateMessage,
  ImageMessage,
} from "../graphql/types/converted";
import { MessageInput } from "../graphql/inputs/message.input";
import { plainToInstance } from "class-transformer";
import { tryMap } from "@copilotkit/shared";

export function convertGqlInputToMessages(inputMessages: MessageInput[]): Message[] {
  const messages = tryMap(inputMessages, (message) => {
    if (message.textMessage) {
      return plainToInstance(TextMessage, {
        id: message.id,
        createdAt: message.createdAt,
        role: message.textMessage.role,
        content: message.textMessage.content,
        parentMessageId: message.textMessage.parentMessageId,
      });
    } else if (message.imageMessage) {
      return plainToInstance(ImageMessage, {
        id: message.id,
        createdAt: message.createdAt,
        role: message.imageMessage.role,
        bytes: message.imageMessage.bytes,
        format: message.imageMessage.format,
        parentMessageId: message.imageMessage.parentMessageId,
      });
    } else if (message.actionExecutionMessage) {
      return plainToInstance(ActionExecutionMessage, {
        id: message.id,
        createdAt: message.createdAt,
        name: message.actionExecutionMessage.name,
        arguments: JSON.parse(message.actionExecutionMessage.arguments),
        parentMessageId: message.actionExecutionMessage.parentMessageId,
      });
    } else if (message.resultMessage) {
      return plainToInstance(ResultMessage, {
        id: message.id,
        createdAt: message.createdAt,
        actionExecutionId: message.resultMessage.actionExecutionId,
        actionName: message.resultMessage.actionName,
        result: message.resultMessage.result,
      });
    } else if (message.agentStateMessage) {
      return plainToInstance(AgentStateMessage, {
        id: message.id,
        threadId: message.agentStateMessage.threadId,
        createdAt: message.createdAt,
        agentName: message.agentStateMessage.agentName,
        nodeName: message.agentStateMessage.nodeName,
        runId: message.agentStateMessage.runId,
        active: message.agentStateMessage.active,
        role: message.agentStateMessage.role,
        state: JSON.parse(message.agentStateMessage.state),
        running: message.agentStateMessage.running,
      });
    } else {
      return null;
    }
  });

  return messages.filter((m) => m);
}
