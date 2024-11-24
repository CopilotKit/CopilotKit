import {
  ActionExecutionMessageInput,
  ResultMessageInput,
  TextMessageInput,
  AgentStateMessageInput,
  ContentMessageInput,
  TextContentBlockInput,
  ImageURLContentBlockInput,
} from "../../inputs/message.input";
import { BaseMessage } from "../base";
import { ActionExecutionScope, MessageRole } from "../enums";

export type MessageContent = ImageURLContentBlockInput | TextContentBlockInput;

export class TextMessage extends BaseMessage implements TextMessageInput {
  content: string;
  role: MessageRole;
}

export class ContentMessage extends BaseMessage implements ContentMessageInput {
  content: MessageContent[]; // Correctly maps to the MessageContentInput array
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

export class AgentStateMessage
    extends BaseMessage
    implements Omit<AgentStateMessageInput, "state">
{
  threadId: string;
  agentName: string;
  nodeName: string;
  runId: string;
  active: boolean;
  role: MessageRole;
  state: any;
  running: boolean;
}