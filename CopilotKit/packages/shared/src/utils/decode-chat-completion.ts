import { ChatCompletionChunk } from "./parse-chat-completion";

export interface ChatCompletionContentEvent {
  type: "content";
  content: string;
}

export interface ChatCompletionPartialEvent {
  type: "partial";
  name: string;
  arguments: string;
}

export interface ChatCompletionFunctionEvent {
  type: "function";
  name: string;
  arguments: any;
}

export type ChatCompletionEvent =
  | ChatCompletionContentEvent
  | ChatCompletionPartialEvent
  | ChatCompletionFunctionEvent;

export function decodeChatCompletion(
  stream: ReadableStream<ChatCompletionChunk>,
): ReadableStream<ChatCompletionEvent> {
  const reader = stream.getReader();

  let mode: "function" | "message" | null = null;
  let functionCallName: string = "";
  let functionCallArguments: string = "";

  async function cleanup(controller?: ReadableStreamDefaultController<any>) {
    if (controller) {
      try {
        controller.close();
      } catch (_) {}
    }
    if (reader) {
      try {
        await reader.cancel();
      } catch (_) {}
    }
  }

  return new ReadableStream<ChatCompletionEvent>({
    async pull(controller) {
      const flushFunctionCall = (): boolean => {
        let args: any = null;
        try {
          args = JSON.parse(functionCallArguments);
        } catch (error) {
          cleanup(controller);
          controller.error(error);
          return false;
        }
        controller.enqueue({
          type: "function",
          name: functionCallName,
          arguments: args,
        });

        mode = null;
        functionCallName = "";
        functionCallArguments = "";
        return true;
      };

      while (true) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            if (mode === "function") {
              flushFunctionCall();
            }
            await cleanup(controller);
            return;
          }

          // In case we are in a function call but the next message is not a function call, flush it.
          if (mode === "function" && !value.choices[0].delta.function_call) {
            if (!flushFunctionCall()) {
              return;
            }
          }

          mode = value.choices[0].delta.function_call ? "function" : "message";

          // if we get a message, emit the content and continue;
          if (mode === "message") {
            if (value.choices[0].delta.content) {
              controller.enqueue({
                type: "content",
                content: value.choices[0].delta.content,
              });
            }
            continue;
          }
          // if we get a function call, buffer the name and arguments, then emit a partial event.
          else if (mode === "function") {
            if (value.choices[0].delta.function_call!.name) {
              functionCallName = value.choices[0].delta.function_call!.name!;
            }
            if (value.choices[0].delta.function_call!.arguments) {
              functionCallArguments += value.choices[0].delta.function_call!.arguments!;
            }
            controller.enqueue({
              type: "partial",
              name: functionCallName,
              arguments: functionCallArguments,
            });
            continue;
          }
        } catch (error) {
          controller.error(error);
          await cleanup(controller);
          return;
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
