import { createOpenAI } from "@ai-sdk/openai";
import { randomUUID } from "@copilotkit/shared";
import { isRecord } from "./converters/usage";

// Reuse the pinned SDK for tools, images, errors, usage and SSE parsing. Its
// OpenAI chat adapter does not yet read/write MiniMax's reasoning_content.
type ChatModel = ReturnType<ReturnType<typeof createOpenAI>["chat"]>;
type CallOptions = Parameters<ChatModel["doStream"]>[0];
type StreamPart =
  Awaited<ReturnType<ChatModel["doStream"]>>["stream"] extends ReadableStream<
    infer T
  >
    ? T
    : never;

function reasoningContent(value: unknown, field: "delta" | "message") {
  if (!isRecord(value) || !Array.isArray(value.choices)) return undefined;
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice[field])) return undefined;
  const reasoning = choice[field].reasoning_content;
  if (reasoning != null && typeof reasoning !== "string") {
    throw new Error("MiniMax returned non-string reasoning_content");
  }
  return reasoning as string | undefined;
}

export function createMiniMaxModel(
  modelId: string,
  settings: { name: string; apiKey: string; baseURL: string },
): ChatModel {
  const model = createOpenAI(settings).chat(modelId);

  function prepare(options: CallOptions) {
    // AG-UI stores reasoning, text and tool calls as separate messages. Join
    // consecutive assistant parts back into the complete provider response.
    const prompt: CallOptions["prompt"] = [];
    for (const message of options.prompt) {
      const previous = prompt[prompt.length - 1];
      if (message.role === "assistant" && previous?.role === "assistant") {
        previous.content = [...previous.content, ...message.content];
      } else {
        prompt.push({ ...message });
      }
    }
    const reasoning = prompt
      .filter((message) => message.role === "assistant")
      .map((message) =>
        message.content
          .filter((part) => part.type === "reasoning")
          .map((part) => part.text)
          .join(""),
      );
    // Remove reasoning only from the SDK input, after saving it for its actual
    // serialized assistant message. This avoids false unsupported-part warnings.
    const sdkPrompt = prompt.map((message) =>
      message.role === "assistant"
        ? {
            ...message,
            content: message.content.filter(
              (part) => part.type !== "reasoning",
            ),
          }
        : message,
    );
    let requestBody: unknown;
    const delegate = createOpenAI({
      ...settings,
      // Preserve runtime-specific fetch properties (such as Bun's preconnect).
      fetch: new Proxy(globalThis.fetch, {
        apply(fetch, thisArg, [url, init]) {
          const body = JSON.parse(init.body as string);
          let index = 0;
          for (const message of body.messages) {
            if (message.role === "assistant") {
              const text = reasoning[index++];
              if (text) message.reasoning_content = text;
            }
          }
          requestBody = body;
          return Reflect.apply(fetch, thisArg, [
            url,
            { ...init, body: JSON.stringify(body) },
          ]);
        },
      }),
    }).chat(modelId);
    return {
      delegate,
      options: { ...options, prompt: sdkPrompt },
      request: () => ({ body: requestBody }),
    };
  }

  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    async doGenerate(options) {
      const call = prepare(options);
      const result = await call.delegate.doGenerate(call.options);
      const reasoning = reasoningContent(result.response?.body, "message");
      if (reasoning)
        result.content.unshift({ type: "reasoning", text: reasoning });
      return { ...result, request: call.request() };
    },
    async doStream(options) {
      const call = prepare(options);
      const result = await call.delegate.doStream({
        ...call.options,
        includeRawChunks: true,
      });
      let activeReasoning = false;
      let reasoningId = "";
      const closeReasoning = (
        controller: TransformStreamDefaultController<StreamPart>,
      ) => {
        if (activeReasoning) {
          controller.enqueue({ type: "reasoning-end", id: reasoningId });
          activeReasoning = false;
        }
      };
      return {
        ...result,
        request: call.request(),
        stream: result.stream.pipeThrough(
          new TransformStream<StreamPart, StreamPart>({
            transform(part, controller) {
              if (part.type === "raw") {
                const text = reasoningContent(part.rawValue, "delta");
                if (text) {
                  if (!activeReasoning) {
                    reasoningId = randomUUID();
                    controller.enqueue({
                      type: "reasoning-start",
                      id: reasoningId,
                    });
                    activeReasoning = true;
                  }
                  controller.enqueue({
                    type: "reasoning-delta",
                    id: reasoningId,
                    delta: text,
                  });
                }
                if (options.includeRawChunks) controller.enqueue(part);
                return;
              }
              if (
                part.type !== "stream-start" &&
                part.type !== "response-metadata"
              )
                closeReasoning(controller);
              controller.enqueue(part);
            },
            flush: closeReasoning,
          }),
        ),
      };
    },
  };
}
