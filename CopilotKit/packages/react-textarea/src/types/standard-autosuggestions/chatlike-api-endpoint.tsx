import { MinimalChatGPTMessage } from "..";

export type ChatlikeApiEndpointImpl = (
  abortSignal: AbortSignal,
  messages: MinimalChatGPTMessage[],
  forwardedProps?: { [key: string]: any }
) => Promise<string>;

export class ChatlikeApiEndpoint {
  public run: ChatlikeApiEndpointImpl;

  constructor(run: ChatlikeApiEndpointImpl) {
    this.run = run;
  }

  /**
   * Creates a new instance of ChatlikeApiEndpoint with the provided API endpoint.
   * @param apiEndpoint The URL of the OpenAI-compatible API endpoint.
   * @returns A new instance of ChatlikeApiEndpoint.
   */
  static standardOpenAIEndpoint(apiEndpoint: string): ChatlikeApiEndpoint {
    return new ChatlikeApiEndpoint(
      async (
        abortSignal: AbortSignal,
        messages: MinimalChatGPTMessage[],
        forwardedProps?: { [key: string]: any }
      ) => {
        const res = await fetch(apiEndpoint, {
          method: "POST",
          body: JSON.stringify({
            ...forwardedProps,
            messages: messages,
          }),
          signal: abortSignal,
        });

        const json = await res.json();
        const suggestion = json.choices[0].message.content;
        return suggestion;
      }
    );
  }

  /**
   * Creates a fully customized instance of ChatlikeApiEndpoint.
   * @param run - The implementation of the ChatlikeApiEndpointImpl interface.
   * @returns A new instance of ChatlikeApiEndpoint .
   */
  static custom(run: ChatlikeApiEndpointImpl): ChatlikeApiEndpoint {
    return new ChatlikeApiEndpoint(run);
  }
}
