import { randomId } from "@copilotkit/shared";
import {
  ActionExecutionMessageInput,
  MessageRole,
  MessageStatus,
  ResultMessageInput,
  TextMessageInput,
  BaseMessageOutput,
  AgentStateMessageInput,
  MessageStatusCode,
  LangGraphInterruptEvent as GqlLangGraphInterruptEvent,
  MetaEventName,
  CopilotKitLangGraphInterruptEvent as GqlCopilotKitLangGraphInterruptEvent,
  ImageMessageInput,
} from "../graphql/@generated/graphql";
import { parseJson } from "@copilotkit/shared";

type MessageType =
  | "TextMessage"
  | "ActionExecutionMessage"
  | "ResultMessage"
  | "AgentStateMessage"
  | "ImageMessage";

export class Message {
  type: MessageType;
  id: BaseMessageOutput["id"];
  createdAt: BaseMessageOutput["createdAt"];
  status: MessageStatus;

  constructor(props: any) {
    props.id ??= randomId();
    props.status ??= { code: MessageStatusCode.Success };
    props.createdAt ??= new Date();
    Object.assign(this, props);
  }

  isTextMessage(): this is TextMessage {
    return this.type === "TextMessage";
  }

  isActionExecutionMessage(): this is ActionExecutionMessage {
    return this.type === "ActionExecutionMessage";
  }

  isResultMessage(): this is ResultMessage {
    return this.type === "ResultMessage";
  }

  isAgentStateMessage(): this is AgentStateMessage {
    return this.type === "AgentStateMessage";
  }

  isImageMessage(): this is ImageMessage {
    return this.type === "ImageMessage";
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
  parentMessageId: TextMessageInput["parentMessageId"];

  constructor(props: TextMessageConstructorOptions) {
    super(props);
    this.type = "TextMessage";
  }
}

type ActionExecutionMessageConstructorOptions = MessageConstructorOptions &
  Omit<ActionExecutionMessageInput, "arguments"> & {
    arguments: Record<string, any>;
  };

export class ActionExecutionMessage
  extends Message
  implements Omit<ActionExecutionMessageInput, "arguments" | "scope">
{
  name: ActionExecutionMessageInput["name"];
  arguments: Record<string, any>;
  parentMessageId: ActionExecutionMessageInput["parentMessageId"];
  constructor(props: ActionExecutionMessageConstructorOptions) {
    super(props);
    this.type = "ActionExecutionMessage";
  }
}

type ResultMessageConstructorOptions = MessageConstructorOptions & ResultMessageInput;

export class ResultMessage extends Message implements ResultMessageConstructorOptions {
  actionExecutionId: ResultMessageInput["actionExecutionId"];
  actionName: ResultMessageInput["actionName"];
  result: ResultMessageInput["result"];

  constructor(props: ResultMessageConstructorOptions) {
    super(props);
    this.type = "ResultMessage";
  }

  static decodeResult(result: string): any {
    return parseJson(result, result);
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

export class AgentStateMessage extends Message implements Omit<AgentStateMessageInput, "state"> {
  agentName: AgentStateMessageInput["agentName"];
  state: any;
  running: AgentStateMessageInput["running"];
  threadId: AgentStateMessageInput["threadId"];
  role: AgentStateMessageInput["role"];
  nodeName: AgentStateMessageInput["nodeName"];
  runId: AgentStateMessageInput["runId"];
  active: AgentStateMessageInput["active"];

  constructor(props: any) {
    super(props);
    this.type = "AgentStateMessage";
  }
}

type ImageMessageConstructorOptions = MessageConstructorOptions & ImageMessageInput;

export class ImageMessage extends Message implements ImageMessageConstructorOptions {
  format: ImageMessageInput["format"];
  bytes: ImageMessageInput["bytes"];
  role: ImageMessageInput["role"];
  parentMessageId: ImageMessageInput["parentMessageId"];

  constructor(props: ImageMessageConstructorOptions) {
    super(props);
    this.type = "ImageMessage";
  }
}

export function langGraphInterruptEvent(
  eventProps: Omit<LangGraphInterruptEvent, "name" | "type" | "__typename">,
): LangGraphInterruptEvent {
  return { ...eventProps, name: MetaEventName.LangGraphInterruptEvent, type: "MetaEvent" };
}

export type LangGraphInterruptEvent<TValue extends any = any> = GqlLangGraphInterruptEvent & {
  value: TValue;
};

type CopilotKitLangGraphInterruptEvent<TValue extends any = any> =
  GqlCopilotKitLangGraphInterruptEvent & {
    data: GqlCopilotKitLangGraphInterruptEvent["data"] & { value: TValue };
  };

export type MetaEvent = LangGraphInterruptEvent | CopilotKitLangGraphInterruptEvent;
