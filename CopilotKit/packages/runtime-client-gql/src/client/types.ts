import { randomId } from "@copilotkit/shared";
import {
  ActionExecutionMessageInput,
  MessageRole,
  MessageStatus,
  ResultMessageInput,
  TextMessageInput,
  BaseMessageOutput,
  AgentMessageInput,
  MessageStatusCode,
} from "../graphql/@generated/graphql";

export class Message {
  id: BaseMessageOutput["id"];
  createdAt: BaseMessageOutput["createdAt"];
  status: MessageStatus;

  constructor(props: any) {
    props.id ??= randomId();
    props.status ??= { code: MessageStatusCode.Success };
    props.createdAt ??= new Date();
    Object.assign(this, props);
  }
}

// alias Role to MessageRole
export const Role = MessageRole;

// when constructing any message, the base fields are optional
type MessageConstructorOptions = Partial<Message>;

type TextMessageConstructorOptions = MessageConstructorOptions & TextMessageInput;

export class TextMessage extends Message implements TextMessageConstructorOptions {
  role: TextMessageInput["role"];
  content: TextMessageInput["content"];

  constructor(props: TextMessageConstructorOptions) {
    super(props);
  }
}

type ActionExecutionMessageConstructorOptions = MessageConstructorOptions &
  Omit<ActionExecutionMessageInput, "arguments"> & {
    arguments: Record<string, any>;
  };

export class ActionExecutionMessage
  extends Message
  implements Omit<ActionExecutionMessageInput, "arguments">
{
  name: ActionExecutionMessageInput["name"];
  arguments: Record<string, any>;
  scope: ActionExecutionMessageInput["scope"];

  constructor(props: ActionExecutionMessageConstructorOptions) {
    super(props);
  }
}

type ResultMessageConstructorOptions = MessageConstructorOptions & ResultMessageInput;

export class ResultMessage extends Message implements ResultMessageConstructorOptions {
  actionExecutionId: ResultMessageInput["actionExecutionId"];
  actionName: ResultMessageInput["actionName"];
  result: ResultMessageInput["result"];

  constructor(props: ResultMessageConstructorOptions) {
    super(props);
  }

  static decodeResult(result: string): any {
    try {
      return JSON.parse(result);
    } catch (e) {
      return result;
    }
  }

  static encodeResult(result: any): string {
    if (result === undefined) {
      return "";
    } else if (typeof result === "string") {
      return result;
    } else {
      return JSON.stringify(result);
    }
  }
}

export class AgentMessage extends Message implements Omit<AgentMessageInput, "state"> {
  agentName: AgentMessageInput["agentName"];
  state: any;
  running: AgentMessageInput["running"];
  threadId: AgentMessageInput["threadId"];
  role: AgentMessageInput["role"];
  nodeName: AgentMessageInput["nodeName"];
}
