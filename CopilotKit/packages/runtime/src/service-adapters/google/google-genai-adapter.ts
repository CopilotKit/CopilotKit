/**
 * Copilot Runtime adapter for Google Generative AI (e.g. Gemini).
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, GoogleGenerativeAIAdapter } from "@copilotkit/runtime";
 * const { GoogleGenerativeAI } = require("@google/generative-ai");
 *
 * const genAI = new GoogleGenerativeAI(process.env["GOOGLE_API_KEY"]);
 *
 * const copilotKit = new CopilotRuntime();
 *
 * const model = genAI.getGenerativeModel({
 *   model: "gemini-pro"
 * });
 *
 * const serviceAdapter = new GoogleGenerativeAIAdapter({ model });
 *
 * return copilotKit.streamHttpServerResponse(req, res, serviceAdapter);
 * ```
 */
import { CopilotServiceAdapter } from "../service-adapter";
import {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import { GenerativeModel, GoogleGenerativeAI } from "@google/generative-ai";
import { TextMessage } from "../../graphql/types/converted";
import { convertMessageToGoogleGenAIMessage, transformActionToGoogleGenAITool } from "./utils";
import { randomId } from "@copilotkit/shared";

interface GoogleGenerativeAIAdapterOptions {
  /**
   * A custom Google Generative AI model to use.
   */
  model?: GenerativeModel;
}

export class GoogleGenerativeAIAdapter implements CopilotServiceAdapter {
  private model: GenerativeModel;

  constructor(options?: GoogleGenerativeAIAdapterOptions) {
    if (options?.model) {
      this.model = options.model;
    } else {
      const genAI = new GoogleGenerativeAI(process.env["GOOGLE_API_KEY"]!);
      this.model = genAI.getGenerativeModel({ model: "gemini-pro" });
    }
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const { messages, actions, eventSource } = request;

    // get the history (everything except the first and last message)
    const history = messages.slice(1, -1).map(convertMessageToGoogleGenAIMessage);

    // get the current message (the last message)
    const currentMessage = convertMessageToGoogleGenAIMessage(messages.at(-1));
    if (!currentMessage) {
      throw new Error("No current message");
    }

    let systemMessage: string;
    const firstMessage = messages.at(0);
    if (firstMessage instanceof TextMessage && firstMessage.role === "system") {
      systemMessage = firstMessage.content.trim();
    } else {
      throw new Error("First message is not a system message");
    }

    const tools = actions.map(transformActionToGoogleGenAITool);

    const isFirstGenGeminiPro =
      this.model.model === "gemini-pro" || this.model.model === "models/gemini-pro";

    const chat = this.model.startChat({
      history: [
        ...history,
        // gemini-pro does not support system instructions, so we need to add them to the history
        ...(isFirstGenGeminiPro ? [{ role: "user", parts: [{ text: systemMessage }] }] : []),
      ],
      // only gemini-1.5-pro-latest and later supports setting system instructions
      ...(isFirstGenGeminiPro
        ? {}
        : { systemInstruction: { role: "user", parts: [{ text: systemMessage }] } }),
      tools,
    });

    const result = await chat.sendMessageStream(currentMessage.parts);

    eventSource.stream(async (eventStream$) => {
      let isTextMessage = false;
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText === "") {
          continue;
        }
        if (!isTextMessage) {
          isTextMessage = true;
          eventStream$.sendTextMessageStart(randomId());
        }
        eventStream$.sendTextMessageContent(chunkText);
      }
      if (isTextMessage) {
        eventStream$.sendTextMessageEnd();
      }

      let calls = (await result.response).functionCalls();
      if (calls) {
        for (let call of calls) {
          eventStream$.sendActionExecution(
            randomId(),
            call.name,
            JSON.stringify(replaceNewlinesInObject(call.args)),
          );
        }
      }
      eventStream$.complete();
    });

    return {
      threadId: request.threadId || randomId(),
    };
  }
}

function replaceNewlinesInObject(obj: any): any {
  if (typeof obj === "string") {
    return obj.replace(/\\\\n/g, "\n");
  } else if (Array.isArray(obj)) {
    return obj.map(replaceNewlinesInObject);
  } else if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        newObj[key] = replaceNewlinesInObject(obj[key]);
      }
    }
    return newObj;
  }
  return obj;
}
