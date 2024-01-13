import EventEmitter from "eventemitter3";
import { Function, Message, Role } from "../types";
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
    if (params.model && params.model in maxTokensByModel) {
      params.maxTokens ||= maxTokensByModel[params.model];
    } else {
      params.maxTokens ||= DEFAULT_MAX_TOKENS;
    }

    params.functions ||= [];
    params.messages = this.buildPrompt(params);
    return await this.runPrompt(params);
  }

  private buildPrompt(params: ChatCompletionTransportFetchParams): Message[] {
    let maxTokens = params.maxTokens!;
    const messages = params.messages!;
    const functions = params.functions!;
    const functionsNumTokens = countFunctionsTokens(functions);
    if (functionsNumTokens > maxTokens) {
      throw new Error(`Too many tokens in function calls: ${functionsNumTokens} > ${maxTokens}`);
    }
    maxTokens -= functionsNumTokens;

    for (const message of messages) {
      if (message.role === "system") {
        const numTokens = this.countTokens(message);
        maxTokens -= numTokens;

        if (maxTokens < 0) {
          throw new Error("Not enough tokens for system message.");
        }
      }
    }

    const result: Message[] = [];
    let cutoff: boolean = false;

    const reversedMessages = [...messages].reverse();
    for (const message of reversedMessages) {
      if (message.role === "system") {
        result.unshift(message);
        continue;
      } else if (cutoff) {
        continue;
      }
      let numTokens = this.countTokens(message);
      if (maxTokens < numTokens) {
        cutoff = true;
        continue;
      }
      result.unshift(message);
      maxTokens -= numTokens;
    }

    return result;
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

  public countTokens(message: Message): number {
    if (message.content) {
      return estimateTokens(message.content);
    } else if (message.function_call) {
      return estimateTokens(JSON.stringify(message.function_call));
    }
    return 0;
  }
}

const maxTokensByModel: { [key: string]: number } = {
  "gpt-3.5-turbo": 4097,
  "gpt-3.5-turbo-16k": 16385,
  "gpt-4": 8192,
  "gpt-4-1106-preview": 8192,
  "gpt-4-32k": 32768,
  "gpt-3.5-turbo-0301": 4097,
  "gpt-4-0314": 8192,
  "gpt-4-32k-0314": 32768,
  "gpt-3.5-turbo-0613": 4097,
  "gpt-4-0613": 8192,
  "gpt-4-32k-0613": 32768,
  "gpt-3.5-turbo-16k-0613": 16385,
};

function estimateTokens(text: string): number {
  return text.length / 3;
}

function countFunctionsTokens(functions: Function[]): number {
  if (functions.length === 0) {
    return 0;
  }
  const json = JSON.stringify(functions);
  return estimateTokens(json);
}
