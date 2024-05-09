import {
  Action,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  MappedParameterTypes,
  Message,
  Parameter,
} from "@copilotkit/shared";
import { CopilotContextParams } from "../context";
import { defaultCopilotContextCategories } from "../components";
import { fetchAndDecodeChatCompletion } from "./fetch-chat-completion";
import untruncateJson from "untruncate-json";

interface InitialState<T extends Parameter[] | [] = []> {
  status: "initial";
  args: Partial<MappedParameterTypes<T>>;
}

interface InProgressState<T extends Parameter[] | [] = []> {
  status: "inProgress";
  args: Partial<MappedParameterTypes<T>>;
}

interface CompleteState<T extends Parameter[] | [] = []> {
  status: "complete";
  args: MappedParameterTypes<T>;
}

type StreamHandlerArgs<T extends Parameter[] | [] = []> =
  | InitialState<T>
  | InProgressState<T>
  | CompleteState<T>;

interface ExtractOptions<T extends Parameter[]> {
  context: CopilotContextParams;
  instructions: string;
  parameters: T;
  include?: IncludeOptions;
  data?: any;
  abortSignal?: AbortSignal;
  stream?: (args: StreamHandlerArgs<T>) => void;
}

interface IncludeOptions {
  readable?: boolean;
  messages?: boolean;
}

export async function extract<const T extends Parameter[]>({
  context,
  instructions,
  parameters,
  include,
  data,
  abortSignal,
  stream,
}: ExtractOptions<T>): Promise<MappedParameterTypes<T>> {
  const { messages } = context;

  const action: Action<any> = {
    name: "extract",
    parameters,
    handler: (args: any) => {},
  };

  const includeReadable = include?.readable ?? false;
  const includeMessages = include?.messages ?? false;

  let contextString = "";

  if (data) {
    contextString = (typeof data === "string" ? data : JSON.stringify(data)) + "\n\n";
  }

  if (includeReadable) {
    contextString += context.getContextString([], defaultCopilotContextCategories);
  }

  const systemMessage: Message = {
    id: "system",
    content: makeSystemMessage(contextString, instructions),
    role: "system",
  };

  const headers = {
    ...(context.copilotApiConfig.headers || {}),
    ...(context.copilotApiConfig.publicApiKey
      ? { [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: context.copilotApiConfig.publicApiKey }
      : {}),
  };

  const response = await fetchAndDecodeChatCompletion({
    copilotConfig: context.copilotApiConfig,
    messages: includeMessages ? [systemMessage, ...messages] : [systemMessage],
    tools: context.getChatCompletionFunctionDescriptions({ extract: action }),
    headers,
    body: context.copilotApiConfig.body,
    toolChoice: { type: "function", function: { name: "extract" } },
    signal: abortSignal,
  });

  if (!response.events) {
    throw new Error("extract() failed: Could not fetch chat completion");
  }

  const reader = response.events.getReader();
  let isInitial = true;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value.type === "partial") {
      try {
        let partialArguments = JSON.parse(untruncateJson(value.arguments));
        stream?.({
          status: isInitial ? "initial" : "inProgress",
          args: partialArguments as Partial<MappedParameterTypes<T>>,
        });
        isInitial = false;
      } catch (e) {}
    }

    if (value.type === "function") {
      stream?.({
        status: "complete",
        args: value.arguments as MappedParameterTypes<T>,
      });
      return value.arguments as MappedParameterTypes<T>;
    }
  }

  throw new Error("extract() failed: No function call occurred");
}

function makeSystemMessage(contextString: string, instructions: string): string {
  return `
Please act as an efficient, competent, conscientious, and industrious professional assistant.

Help the user achieve their goals, and you do so in a way that is as efficient as possible, without unnecessary fluff, but also without sacrificing professionalism.
Always be polite and respectful, and prefer brevity over verbosity.

The user has provided you with the following context:
\`\`\`
${contextString}
\`\`\`

They have also provided you with a function you MUST call to initiate actions on their behalf.

Please assist them as best you can.

This is not a conversation, so please do not ask questions. Just call the function without saying anything else.

The user has given you the following task to complete:

\`\`\`
${instructions}
\`\`\`

Any additional messages provided are for providing context only and should not be used to ask questions or engage in conversation.
`;
}
