import { AssistantMessage, formatStreamPart } from "@copilotkit/shared";

export function experimental_AssistantResponse(
  { threadId, messageId }: { threadId: string; messageId: string },
  process: (stream: {
    threadId: string;
    messageId: string;
    sendMessage: (message: AssistantMessage) => void;
  }) => Promise<void>,
): Response {
  const stream = new ReadableStream({
    async start(controller): Promise<void> {
      const textEncoder = new TextEncoder();

      const sendMessage = (message: AssistantMessage) => {
        controller.enqueue(textEncoder.encode(formatStreamPart("assistant_message", message)));
      };

      const sendError = (errorMessage: string) => {
        controller.enqueue(textEncoder.encode(formatStreamPart("error", errorMessage)));
      };

      // send the threadId and messageId as the first message:
      controller.enqueue(
        textEncoder.encode(
          formatStreamPart("assistant_control_data", {
            threadId,
            messageId,
          }),
        ),
      );

      try {
        await process({
          threadId,
          messageId,
          sendMessage,
        });
      } catch (error) {
        sendError((error as any).message ?? `${error}`);
      } finally {
        controller.close();
      }
    },
    pull(controller) {},
    cancel() {},
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
