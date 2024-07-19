import {
  ActionExecutionMessageInput,
  ResultMessageInput,
  TextMessageInput,
  AgentMessageInput,
} from "../../inputs/message.input";
import { BaseMessage } from "../base";
import { ActionExecutionScope, MessageRole } from "../enums";

export class TextMessage extends BaseMessage implements TextMessageInput {
  content: string;
  role: MessageRole;
}

export type Message = BaseMessage;

export class ActionExecutionMessage
  extends BaseMessage
  implements Omit<ActionExecutionMessageInput, "arguments">
{
  name: string;
  arguments: Record<string, any>;
  scope: ActionExecutionScope;
}

export class ResultMessage extends BaseMessage implements ResultMessageInput {
  actionExecutionId: string;
  actionName: string;
  result: string;
}

export class AgentMessage extends BaseMessage implements AgentMessageInput {
  threadId: string;
  agentName: string;
  role: MessageRole;
  state: string;
  running: boolean;
}
