import {
  AnnotatedFunction,
  FunctionCall,
  Message,
  Role,
  annotatedFunctionToChatCompletionFunction,
} from "@copilotkit/shared";
import { CopilotApiConfig, CopilotContextParams } from "../context";
import { defaultCopilotContextCategories } from "../components";
import { fetchAndDecodeChatCompletion } from "../utils/fetch-chat-completion";

export interface CopilotTaskConfig {
  /**
   * The instructions to be given to the assistant.
   */
  instructions: string;
  /**
   * The data to use for the task.
   */
  data?: any;
  /**
   * An optional context object to use for the task.
   */
  context?: CopilotContextParams;
  /**
   * Function definitions to be sent to the API.
   */
  functions?: AnnotatedFunction<any[]>[];
  /**
   * The API endpoint that accepts a `{ messages: Message[] }` object and returns
   */
  url?: string;
  /**
   * HTTP headers to be sent with the API request.
   */
  headers?: Record<string, string>;
  /**
   * Extra body object to be sent with the API request.
   * @example
   * Send a `sessionId` to the API along with the messages.
   * ```js
   * useChat({
   *   body: {
   *     sessionId: '123',
   *   }
   * })
   * ```
   */
  body?: object;
}

export class CopilotTask {
  private instructions: string;
  private data?: any;
  private context?: CopilotContextParams;
  private functions: AnnotatedFunction<any[]>[];
  private copilotConfig: CopilotApiConfig;

  constructor(config: CopilotTaskConfig) {
    this.instructions = config.instructions;
    this.data = config.data;
    this.context = config.context;
    this.functions = config.functions || [];

    if (this.context && config.functions?.length) {
      console.warn(
        "You provided both a context and functions to CopilotTask. The functions will be ignored.",
      );
    } else if (!this.context && !config.functions?.length) {
      throw new Error("No context or functions provided for CopilotTask");
    }

    if (this.context) {
      this.copilotConfig = this.context.copilotApiConfig;
    } else if (config.url) {
      this.copilotConfig = {
        chatApiEndpoint: config.url,
        chatApiEndpointV2: config.url, // TODO remove
        headers: config.headers || {},
        body: config.body || {},
      };
    } else {
      throw new Error("No context or url provided for CopilotTask");
    }
  }

  async run(): Promise<void> {
    const functions = this.functions.map(annotatedFunctionToChatCompletionFunction);
    let contextString = "";

    if (this.data) {
      contextString =
        (typeof this.data === "string" ? this.data : JSON.stringify(this.data)) + "\n\n";
    }

    if (this.context) {
      contextString += this.context.getContextString([], defaultCopilotContextCategories);
    }

    const systemMessage: Message = {
      id: "system",
      content: taskSystemMessage(contextString, this.instructions),
      role: "system",
    };

    const messages = [systemMessage];

    const response = await fetchAndDecodeChatCompletion({
      copilotConfig: this.copilotConfig,
      messages: messages,
      functions: this.context ? this.context.getChatCompletionFunctionDescriptions() : functions,
      headers: this.copilotConfig.headers,
    });

    if (!response.events) {
      throw new Error("Failed to execute task");
    }

    const reader = response.events.getReader();
    let functionCall: FunctionCall | undefined;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value.type === "function") {
        functionCall = {
          name: value.name,
          arguments: JSON.stringify(value.arguments),
        };
        break;
      }
    }

    if (!functionCall) {
      throw new Error("No function call occurred");
    }

    if (this.context) {
      // use the function call handler of the context
      const functionCallHandler = this.context.getFunctionCallHandler();
      await functionCallHandler(messages, functionCall);
    } else {
      // manually call function
      await callFunction(this.functions, functionCall);
    }
  }
}

// TODO move this to shared
async function callFunction(entryPoints: AnnotatedFunction<any[]>[], functionCall: FunctionCall) {
  let entrypointsByFunctionName: Record<string, AnnotatedFunction<any[]>> = {};
  for (let entryPoint of entryPoints) {
    entrypointsByFunctionName[entryPoint.name] = entryPoint;
  }

  const entryPointFunction = entrypointsByFunctionName[functionCall.name || ""];
  if (entryPointFunction) {
    let functionCallArguments: Record<string, any>[] = [];
    if (functionCall.arguments) {
      functionCallArguments = JSON.parse(functionCall.arguments);
    }

    const paramsInCorrectOrder: any[] = [];
    for (let arg of entryPointFunction.argumentAnnotations) {
      paramsInCorrectOrder.push(
        functionCallArguments[arg.name as keyof typeof functionCallArguments],
      );
    }

    await entryPointFunction.implementation(...paramsInCorrectOrder);
  } else {
    throw new Error(`No function found with name ${functionCall.name}`);
  }
}

function taskSystemMessage(contextString: string, instructions: string): string {
  return `
Please act as an efficient, competent, conscientious, and industrious professional assistant.

Help the user achieve their goals, and you do so in a way that is as efficient as possible, without unnecessary fluff, but also without sacrificing professionalism.
Always be polite and respectful, and prefer brevity over verbosity.

The user has provided you with the following context:
\`\`\`
${contextString}
\`\`\`

They have also provided you with functions you can call to initiate actions on their behalf.

Please assist them as best you can.

This is not a conversation, so please do not ask questions. Just call a function without saying anything else.

The user has given you the following task to complete:

\`\`\`
${instructions}
\`\`\`
`;
}
