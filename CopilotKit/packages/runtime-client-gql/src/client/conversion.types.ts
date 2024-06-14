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
}

export type Role = MessageRole;

export class TextMessage extends Message implements TextMessageInput {
  role: TextMessageInput["role"];
  content: TextMessageInput["content"];
}

export class ActionExecutionMessage
  extends Message
  implements Omit<ActionExecutionMessageInput, "arguments">
{
  name: ActionExecutionMessageInput["name"];
  arguments: Record<string, any>;
  scope: ActionExecutionMessageInput["scope"];
}

export class ResultMessage extends Message implements ResultMessageInput {
  actionExecutionId: ResultMessageInput["actionExecutionId"];
  actionName: ResultMessageInput["actionName"];
  result: ResultMessageInput["result"];

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
