import { ChatCompletionEvent } from "./decode-chat-completion";

export function decodeChatCompletionAsText(
  stream: ReadableStream<ChatCompletionEvent>,
): ReadableStream<string> {
  const reader = stream.getReader();

  return new ReadableStream<string>({
    async pull(controller) {
      while (true) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            controller.close();
            return;
          }

          if (value.type === "content") {
            controller.enqueue(value.content);
            continue;
          }
        } catch (error) {
          controller.error(error);
          return;
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
