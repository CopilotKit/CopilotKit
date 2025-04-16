import {
  ActionExecutionMessageInput,
  ResultMessageInput,
  TextMessageInput,
  AgentStateMessageInput,
  ImageMessageInput,
} from "../../inputs/message.input";
import { BaseMessageInput } from "../base";
import { MessageRole } from "../enums";

export type MessageType =
  | "TextMessage"
  | "ActionExecutionMessage"
  | "ResultMessage"
  | "AgentStateMessage"
  | "ImageMessage";

export class Message extends BaseMessageInput {
  type: MessageType;

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

export class TextMessage extends Message implements TextMessageInput {
  type: MessageType = "TextMessage";
  content: string;
  role: MessageRole;
  parentMessageId?: string;
}

export class ActionExecutionMessage
  extends Message
  implements Omit<ActionExecutionMessageInput, "arguments" | "scope">
{
  type: MessageType = "ActionExecutionMessage";
  name: string;
  arguments: Record<string, any>;
  parentMessageId?: string;
}

export class ResultMessage extends Message implements ResultMessageInput {
  type: MessageType = "ResultMessage";
  actionExecutionId: string;
  actionName: string;
  result: string;

  static encodeResult(
    result: any,
    error?: { code: string; message: string } | string | Error,
  ): string {
    const errorObj = error
      ? typeof error === "string"
        ? { code: "ERROR", message: error }
        : error instanceof Error
          ? { code: "ERROR", message: error.message }
          : error
      : undefined;

    if (errorObj) {
      return JSON.stringify({
        error: errorObj,
        result: result || "",
      });
    }
    if (result === undefined) {
      return "";
    }
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  static decodeResult(result: string): {
    error?: { code: string; message: string };
    result: string;
  } {
    if (!result) {
      return { result: "" };
    }
    try {
      const parsed = JSON.parse(result);
      if (parsed && typeof parsed === "object") {
        if ("error" in parsed) {
          return {
            error: parsed.error,
            result: parsed.result || "",
          };
        }
        return { result: JSON.stringify(parsed) };
      }
      return { result };
    } catch (e) {
      return { result };
    }
  }

  hasError(): boolean {
    try {
      const { error } = ResultMessage.decodeResult(this.result);
      return !!error;
    } catch {
      return false;
    }
  }

  getError(): { code: string; message: string } | undefined {
    try {
      const { error } = ResultMessage.decodeResult(this.result);
      return error;
    } catch {
      return undefined;
    }
  }
}

export class AgentStateMessage extends Message implements Omit<AgentStateMessageInput, "state"> {
  type: MessageType = "AgentStateMessage";
  threadId: string;
  agentName: string;
  nodeName: string;
  runId: string;
  active: boolean;
  role: MessageRole;
  state: any;
  running: boolean;
}

export class ImageMessage extends Message implements ImageMessageInput {
  type: MessageType = "ImageMessage";
  format: string;
  bytes: string;
  role: MessageRole;
  parentMessageId?: string;
}
