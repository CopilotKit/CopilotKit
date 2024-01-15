import EventEmitter from "eventemitter3";
import { Message, Function } from "@copilotkit/shared";
import { CopilotApiConfig } from "../context";

export interface ChatCompletionTransportConfiguration {}

interface ChatCompletionTransportEvents {
  end: void;
  data: any;
  error: any;
}

export interface ChatCompletionTransportFetchParams {
  copilotConfig: CopilotApiConfig;
  model?: string;
  messages: Message[];
  functions?: Function[];
  temperature?: number;
  maxTokens?: number;
  headers?: Record<string, string> | Headers;
  body?: object;
  signal?: AbortSignal;
}

const DEFAULT_MODEL = "gpt-4-1106-preview";

export class ChatCompletionTransport extends EventEmitter<ChatCompletionTransportEvents> {
  private buffer = new Uint8Array();
  private bodyReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(params: ChatCompletionTransportConfiguration) {
    super();
  }

  private async cleanup() {
    if (this.bodyReader) {
      try {
        await this.bodyReader.cancel();
      } catch (error) {
        console.warn("Failed to cancel body reader:", error);
      }
    }
    this.bodyReader = null;
    this.buffer = new Uint8Array();
  }

  public async fetch({
    copilotConfig,
    model,
    messages,
    functions,
    temperature,
    headers,
    body,
    signal,
  }: ChatCompletionTransportFetchParams): Promise<void> {
    await this.cleanup();

    temperature ||= 0.5;
    functions ||= [];
    model ||= DEFAULT_MODEL;

    // clean up any extra properties from messages
    const cleanedMessages = messages.map((message) => {
      const { content, role, name, function_call } = message;
      return { content, role, name, function_call };
    });

    try {
      const response = await fetch(copilotConfig.chatApiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...copilotConfig.headers,
          ...(headers ? { ...headers } : {}),
        },
        body: JSON.stringify({
          model,
          messages: cleanedMessages,
          stream: true,
          ...(functions.length ? { functions } : {}),
          ...(temperature ? { temperature } : {}),
          ...(functions.length != 0 ? { function_call: "auto" } : {}),
          ...copilotConfig.body,
          ...(body ? { ...body } : {}),
        }),
        signal,
      });

      if (!response.ok) {
        try {
          const errorText = await response.text();
          await this.cleanup();
          const msg = `Error ${response.status}: ${errorText}`;
          this.emit("error", new Error(msg));
        } catch (_error) {
          await this.cleanup();
          const msg = `Error ${response.status}: ${response.statusText}`;
          this.emit("error", new Error(msg));
        }
        return;
      }

      if (response.body == null) {
        await this.cleanup();
        const msg = "Response body is null";
        this.emit("error", new Error(msg));
        return;
      }

      this.bodyReader = response.body.getReader();

      await this.streamBody();
    } catch (error) {
      await this.cleanup();
      this.emit("error", error);
      return;
    }
  }

  private async streamBody() {
    while (true) {
      try {
        const { done, value } = await this.bodyReader!.read();

        if (done) {
          await this.cleanup();
          this.emit("end");
          return;
        }

        const shouldContinue = await this.processData(value);

        if (!shouldContinue) {
          return;
        }
      } catch (error) {
        await this.cleanup();
        this.emit("error", error);
        return;
      }
    }
  }

  private async processData(data: Uint8Array): Promise<boolean> {
    // Append new data to the temp buffer
    const newBuffer = new Uint8Array(this.buffer.length + data.length);
    newBuffer.set(this.buffer);
    newBuffer.set(data, this.buffer.length);
    this.buffer = newBuffer;

    const dataString = new TextDecoder("utf-8").decode(this.buffer);

    let lines = dataString.split("\n").filter((line) => line.trim() !== "");

    // If the last line isn't complete, keep it in the buffer for next time
    if (!dataString.endsWith("\n")) {
      const lastLine = lines.pop() || "";
      const remainingBytes = new TextEncoder().encode(lastLine);
      this.buffer = new Uint8Array(remainingBytes);
    } else {
      this.buffer = new Uint8Array();
    }

    for (const line of lines) {
      const cleanedLine = line.replace(/^data: /, "");

      if (cleanedLine === "[DONE]") {
        await this.cleanup();
        this.emit("end");
        return false;
      }

      let json;
      try {
        json = JSON.parse(cleanedLine);
      } catch (error) {
        console.error("Failed to parse JSON:", error);
        continue;
      }

      this.emit("data", json);
    }
    return true;
  }
}
