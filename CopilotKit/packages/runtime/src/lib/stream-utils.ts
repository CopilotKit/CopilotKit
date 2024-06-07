import { Message, parseChatCompletion, decodeChatCompletion } from "@copilotkit/shared";
import { Response } from "express";
import { OutgoingHttpHeaders } from "http2";

export function interceptStreamAndGetFinalResponse(
  stream: any,
  onChunk: (chunk: string) => void,
): Promise<{
  messages: Message[];
  headers: OutgoingHttpHeaders;
}> {
  console.log("intercepting stream");
  return new Promise(async (resolve, reject) => {
    try {
      const buffer: Buffer[] = [];
      const decoder = new TextDecoder();

      for await (const chunk of stream) {
        const str = decoder.decode(chunk);
        const json = await parseResponseString(str);

        // Stream over
        if (json.length === 0) {
          break;
        }

        onChunk(json[0].content);
        buffer.push(Buffer.from(chunk));
      }

      const handleFinalChunk = async () => {
        const completeBuffer = Buffer.concat(buffer);
        const responseString = completeBuffer.toString();
        const parsed = await parseResponseString(responseString);
        resolve({
          messages: parsed,
          headers: {},
        });
      };

      handleFinalChunk();
    } catch (error) {
      console.error("Error intercepting stream", error);
      reject(error);
    }
  });
}

async function parseResponseString(responseString: string) {
  const readableStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const uint8Array = encoder.encode(responseString);
      controller.enqueue(uint8Array);
      controller.close();
    },
  });

  const events = decodeChatCompletion(parseChatCompletion(readableStream));
  const reader = events.getReader();

  const messages: Message[] = [];
  let streamingContentMessage: Message | undefined = undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (streamingContentMessage !== undefined) {
        messages.push(streamingContentMessage);
        streamingContentMessage = undefined;
      }
      break;
    }

    const idValue = undefined;
    if (value.type === "content" && streamingContentMessage === undefined) {
      streamingContentMessage = {
        id: idValue,
        createdAt: new Date(),
        content: value.content,
        role: "assistant",
      };
    } else if (value.type === "content" && streamingContentMessage !== undefined) {
      streamingContentMessage.content += value.content;
    } else {
      if (streamingContentMessage !== undefined) {
        messages.push(streamingContentMessage);
        streamingContentMessage = undefined;
      }

      if (value.type === "result") {
        messages.push({
          id: idValue,
          createdAt: new Date(),
          content: value.content,
          role: "function",
          name: value.name,
        });
      } else if (value.type === "function") {
        messages.push({
          id: idValue,
          createdAt: new Date(),
          content: "",
          role: "function",
          name: value.name,
          function_call: {
            name: value.name,
            arguments: JSON.stringify(value.arguments),
            scope: value.scope,
          },
        });
      }
    }
  }

  return messages;
}
