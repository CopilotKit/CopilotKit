import EventEmitter from "eventemitter3";
import { Function, Message, Role } from "@copilotkit/shared";
import {
  ChatCompletionTransport,
  ChatCompletionTransportFetchParams,
} from "./chat-completion-transport";

interface ChatCompletionClientConfiguration {}

interface ChatCompletionClientEvents {
  content: string;
  partial: [string, string];
  error: any;
  function: {
    name: string;
    arguments: any;
  };
  end: void;
}

export interface ChatCompletionChunk {
  choices: {
    delta: {
      role: Role;
      content?: string | null;
      function_call?: {
        name?: string;
        arguments?: string;
      };
    };
  }[];
}

const DEFAULT_MAX_TOKENS = 8192;

export class ChatCompletionClient extends EventEmitter<ChatCompletionClientEvents> {
  private chatCompletionTransport: ChatCompletionTransport | null = null;
  private mode: "function" | "message" | null = null;
  private functionCallName: string = "";
  private functionCallArguments: string = "";

  constructor(params: ChatCompletionClientConfiguration) {
    super();
  }

  public async fetch(params: ChatCompletionTransportFetchParams) {
    params = { ...params };
    params.functions ||= [];
    return await this.runPrompt(params);
  }

  private async runPrompt(params: ChatCompletionTransportFetchParams): Promise<void> {
    this.chatCompletionTransport = new ChatCompletionTransport({});

    this.chatCompletionTransport.on("data", this.onData);
    this.chatCompletionTransport.on("error", this.onError);
    this.chatCompletionTransport.on("end", this.onEnd);

    await this.chatCompletionTransport.fetch(params);
  }

  private onData = (data: ChatCompletionChunk) => {
    // In case we are in a function call but the next message is not a function call, flush it.
    if (this.mode === "function" && !data.choices[0].delta.function_call) {
      const success = this.tryFlushFunctionCall();
      if (!success) {
        return;
      }
    }

    this.mode = data.choices[0].delta.function_call ? "function" : "message";

    if (this.mode === "message") {
      // if we get a message, emit the content and return;

      if (data.choices[0].delta.content) {
        this.emit("content", data.choices[0].delta.content);
      }

      return;
    } else if (this.mode === "function") {
      // if we get a function call, we buffer the name and arguments, then emit a partial event.

      if (data.choices[0].delta.function_call!.name) {
        this.functionCallName = data.choices[0].delta.function_call!.name!;
      }
      if (data.choices[0].delta.function_call!.arguments) {
        this.functionCallArguments += data.choices[0].delta.function_call!.arguments!;
      }
      this.emit("partial", this.functionCallName, this.functionCallArguments);

      return;
    }
  };

  private onError = (error: any) => {
    this.emit("error", error);
    this.cleanup();
  };

  private onEnd = () => {
    if (this.mode === "function") {
      const success = this.tryFlushFunctionCall();
      if (!success) {
        return;
      }
    }
    this.emit("end");
    this.cleanup();
  };

  private tryFlushFunctionCall(): boolean {
    let args: any = null;
    try {
      args = JSON.parse(this.functionCallArguments);
    } catch (error) {
      this.emit("error", error);
      this.cleanup();
      return false;
    }
    this.emit("function", {
      name: this.functionCallName,
      arguments: args,
    });
    this.mode = null;
    this.functionCallName = "";
    this.functionCallArguments = "";
    return true;
  }

  private cleanup() {
    if (this.chatCompletionTransport) {
      this.chatCompletionTransport.off("data", this.onData);
      this.chatCompletionTransport.off("error", this.onError);
      this.chatCompletionTransport.off("end", this.onEnd);
    }
    this.chatCompletionTransport = null;
    this.mode = null;
    this.functionCallName = "";
    this.functionCallArguments = "";
  }
}
