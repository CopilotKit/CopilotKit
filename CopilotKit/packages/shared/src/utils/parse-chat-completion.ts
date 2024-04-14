import { Role } from "../types/openai-assistant";

export interface ToolCallFunctionCall {
  arguments?: string;

  name?: string;
  // TODO:
  // Temporarily add scope to the OpenAI protocol until we
  // have our own protocol.
  // When scope is "server", the client will not attempt to
  // execute the function.
  scope?: "client" | "server";
}

export interface ToolCallPayload {
  index: number;
  id?: string;
  function: ToolCallFunctionCall;
}

export interface ChatCompletionChunk {
  choices: {
    delta: {
      id?: string;
      role: Role;
      content?: string | null;

      // TODO:
      // Temporarily add name to the OpenAI protocol until we
      // have our own protocol.
      // When name is set, we return the result of a server-side
      // function call.
      name?: string;

      function_call?: {
        name?: string;
        arguments?: string;
      };
      tool_calls?: ToolCallPayload[];
    };
  }[];
}

// TODO:
// it's possible that unicode characters could be split across chunks
// make sure to properly handle that
export function parseChatCompletion(
  stream: ReadableStream<Uint8Array>,
): ReadableStream<ChatCompletionChunk> {
  const reader = stream.getReader();
  let buffer = new Uint8Array();

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

  return new ReadableStream<ChatCompletionChunk>({
    async pull(controller) {
      while (true) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            await cleanup(controller);
            return;
          }

          const newBuffer = new Uint8Array(buffer.length + value.length);
          newBuffer.set(buffer);
          newBuffer.set(value, buffer.length);
          buffer = newBuffer;

          const valueString = new TextDecoder("utf-8").decode(buffer);
          const lines = valueString.split("\n").filter((line) => line.trim() !== "");

          // If the last line isn't complete, keep it in the buffer for next time
          buffer = !valueString.endsWith("\n")
            ? new TextEncoder().encode(lines.pop() || "")
            : new Uint8Array();

          for (const line of lines) {
            const cleanedLine = line.replace(/^data: /, "");

            if (cleanedLine === "[DONE]") {
              await cleanup(controller);
              return;
            }

            const json = JSON.parse(cleanedLine);
            controller.enqueue(json);
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
