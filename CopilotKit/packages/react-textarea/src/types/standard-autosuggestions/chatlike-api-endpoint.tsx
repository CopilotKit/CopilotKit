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

  // Static method
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
}
