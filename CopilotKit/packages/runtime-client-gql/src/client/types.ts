import {
  ActionExecutionMessageInput,
  MessageRole,
  MessageStatus,
  ResultMessageInput,
  TextMessageInput,
  BaseMessageOutput,
} from "../graphql/@generated/graphql";

export class Message {
  id: BaseMessageOutput["id"];
  createdAt: BaseMessageOutput["createdAt"];
  status: MessageStatus;

  constructor(props: any) {
    Object.assign(this, props);
  }
}

export type Role = MessageRole;

// when constructing any message, status is optional
type MessageConstructorOptions = Omit<Message, "status"> & { status?: Message["status"] };

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
    arguments: ActionExecutionMessageInput["arguments"];
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
