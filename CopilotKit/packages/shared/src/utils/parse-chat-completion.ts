import { Role } from "../types/openai-assistant";

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
