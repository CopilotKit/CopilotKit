import { ChatCompletionChunk, ToolCallFunctionCall } from "./parse-chat-completion";

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
  scope: "client" | "server";
}

export interface ChatCompletionResultEvent {
  type: "result";
  content: string;
  name: string;
}

export type ChatCompletionEvent =
  | ChatCompletionContentEvent
  | ChatCompletionPartialEvent
  | ChatCompletionFunctionEvent
  | ChatCompletionResultEvent;

export function decodeChatCompletion(
  stream: ReadableStream<ChatCompletionChunk>,
): ReadableStream<ChatCompletionEvent> {
  const reader = stream.getReader();

  type Mode = { type: "function"; function: ToolCallFunctionCall } | { type: "message" };

  let mode: Mode | null = null;
  let functionCallName: string = "";
  let functionCallArguments: string = "";
  let functionCallScope: "client" | "server" = "client";

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
          scope: functionCallScope,
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
            if (mode?.type === "function") {
              flushFunctionCall();
            }
            await cleanup(controller);
            return;
          }

          // In case we are currently handling a function call but the next message is either
          // - not a function call
          // - or is another function call (indicated by the presence of 'name' field in the next function call object)
          // => flush the current function call.
          if (
            mode?.type === "function" &&
            (!value.choices[0].delta.tool_calls?.[0]?.function ||
              value.choices[0].delta.tool_calls?.[0]?.function.name)
          ) {
            if (!flushFunctionCall()) {
              return;
            }
          }

          const maybeFunctionCall = value.choices[0].delta.tool_calls?.[0]?.function;
          if (maybeFunctionCall) {
            mode = { type: "function", function: maybeFunctionCall };
          } else {
            mode = { type: "message" };
          }

          // if we get a message, emit the content and continue;
          if (mode.type === "message") {
            // if we got a result message, send a result event
            if (value.choices[0].delta.role === "function") {
              controller.enqueue({
                type: "result",
                content: value.choices[0].delta.content!,
                name: value.choices[0].delta.name!,
              });
            }
            // otherwise, send a content event
            else if (value.choices[0].delta.content) {
              controller.enqueue({
                type: "content",
                content: value.choices[0].delta.content,
              });
            }
            continue;
          }
          // if we get a function call, buffer the name and arguments, then emit a partial event.
          else if (mode.type === "function") {
            const maybeFunctionCallName = mode.function.name;
            if (maybeFunctionCallName) {
              functionCallName = maybeFunctionCallName;
            }

            const maybeFunctionCallArguments = mode.function.arguments;
            if (maybeFunctionCallArguments) {
              functionCallArguments += maybeFunctionCallArguments;
            }

            const maybeFunctionCallScope = mode.function.scope;
            if (maybeFunctionCallScope) {
              functionCallScope = maybeFunctionCallScope;
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
