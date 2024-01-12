import {
  ChatCompletionTransport,
  ChatCompletionTransportFetchParams,
} from "./chat-completion-transport";

export interface ChatCompletionStreamConfiguration {
  url: string;
  model?: string;
}

export class ChatCompletionStream {
  private url: string;

  constructor(params: ChatCompletionStreamConfiguration) {
    this.url = params.url;
  }

  public async fetch(params: ChatCompletionTransportFetchParams) {
    params = { ...params };
    params.functions = undefined;

    const transport = new ChatCompletionTransport({
      url: this.url,
    });

    const cleanup = () => {
      transport.off("data");
      transport.off("end");
      transport.off("error");
    };

    const stream = new ReadableStream<string>({
      start: (controller) => {
        transport.on("data", (data) => {
          if (data.choices[0].delta.content) {
            controller.enqueue(data.choices[0].delta.content);
          }
        });

        transport.on("error", (error) => {
          controller.error(error);
          cleanup();
        });

        transport.on("end", () => {
          controller.close();
          cleanup();
        });
      },
    });

    transport.fetch(params);

    return stream;
  }
}
