import {
  Action,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  MappedParameterTypes,
  Parameter,
  actionParametersToJsonSchema,
} from "@copilotkit/shared";
import {
  ActionExecutionMessage,
  Message,
  Role,
  TextMessage,
  convertGqlOutputToMessages,
  CopilotRequestType,
  ForwardedParametersInput,
} from "@copilotkit/runtime-client-gql";
import { CopilotContextParams, CopilotMessagesContextParams } from "../context";
import { defaultCopilotContextCategories } from "../components";
import { CopilotRuntimeClient } from "@copilotkit/runtime-client-gql";
import {
  convertMessagesToGqlInput,
  filterAgentStateMessages,
} from "@copilotkit/runtime-client-gql";

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
  context: CopilotContextParams & CopilotMessagesContextParams;
  instructions: string;
  parameters: T;
  include?: IncludeOptions;
  data?: any;
  abortSignal?: AbortSignal;
  stream?: (args: StreamHandlerArgs<T>) => void;
  requestType?: CopilotRequestType;
  forwardedParameters?: ForwardedParametersInput;
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
  requestType = CopilotRequestType.Task,
  forwardedParameters,
}: ExtractOptions<T>): Promise<MappedParameterTypes<T>> {
  const { messages } = context;

  const action: Action<any> = {
    name: "extract",
    description: instructions,
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

  const systemMessage: Message = new TextMessage({
    content: makeSystemMessage(contextString, instructions),
    role: Role.System,
  });

  const instructionsMessage: Message = new TextMessage({
    content: makeInstructionsMessage(instructions),
    role: Role.User,
  });

  const response = context.runtimeClient.asStream(
    context.runtimeClient.generateCopilotResponse({
      data: {
        frontend: {
          actions: [
            {
              name: action.name,
              description: action.description || "",
              jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters || [])),
            },
          ],
          url: window.location.href,
        },

        messages: convertMessagesToGqlInput(
          includeMessages
            ? [systemMessage, instructionsMessage, ...filterAgentStateMessages(messages)]
            : [systemMessage, instructionsMessage],
        ),
        metadata: {
          requestType: requestType,
        },
        forwardedParameters: {
          ...(forwardedParameters ?? {}),
          toolChoice: "function",
          toolChoiceFunctionName: action.name,
        },
      },
      properties: context.copilotApiConfig.properties,
      signal: abortSignal,
    }),
  );

  const reader = response.getReader();

  let isInitial = true;

  let actionExecutionMessage: ActionExecutionMessage | undefined = undefined;
  let lastError: any = null;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (abortSignal?.aborted) {
        throw new Error("Aborted");
      }

      // Check if the response has a failed status
      const response = value.generateCopilotResponse;
      if (response.status?.code === "Failed") {
        // Extract the original error from the failed status
        const failedStatus = response.status as any;
        const originalError = failedStatus.details?.originalError;
        if (originalError) {
          // Create an error with the original error message and properties
          const error = new Error(
            failedStatus.details.description || originalError.message || "Unknown error",
          );
          // Preserve the original error properties
          Object.assign(error, originalError);
          throw error;
        } else {
          // Fallback to description if no original error
          throw new Error(failedStatus.details?.description || "Request failed");
        }
      }

      const messages = convertGqlOutputToMessages(value.generateCopilotResponse.messages);

      actionExecutionMessage = messages.find((msg) => msg.isActionExecutionMessage()) as
        | ActionExecutionMessage
        | undefined;

      if (!actionExecutionMessage) {
        continue;
      }

      stream?.({
        status: isInitial ? "initial" : "inProgress",
        args: actionExecutionMessage.arguments as Partial<MappedParameterTypes<T>>,
      });

      isInitial = false;
    }
  } catch (error) {
    // Store the original error to re-throw it with more context
    lastError = error;
  }

  // If we have an original error from stream reading, always re-throw it
  // This preserves API errors like authentication failures instead of showing generic messages
  if (lastError) {
    // Try to extract the actual original error from various GraphQL error structures
    let originalError = null;

    // Check direct extensions.originalError
    if ((lastError as any)?.extensions?.originalError) {
      originalError = (lastError as any).extensions.originalError;
    }
    // Check graphQLErrors array (from CopilotRuntimeClient)
    else if ((lastError as any)?.graphQLErrors?.length > 0) {
      const graphQLError = (lastError as any).graphQLErrors[0];
      if (graphQLError?.extensions?.originalError) {
        originalError = graphQLError.extensions.originalError;
      }
    }
    // Check if the error itself has the message we want
    else if (
      (lastError as any)?.message &&
      !(lastError as any).message.includes("extract() failed") &&
      !(lastError as any).message.includes("No function call occurred")
    ) {
      // Use the error as-is if it has a meaningful message
      originalError = lastError;
    }

    if (originalError) {
      // Re-throw the original error with its actual message
      throw originalError;
    }
    throw lastError;
  }

  if (!actionExecutionMessage) {
    throw new Error("extract() failed: No function call occurred");
  }

  stream?.({
    status: "complete",
    args: actionExecutionMessage.arguments as MappedParameterTypes<T>,
  });

  return actionExecutionMessage.arguments as MappedParameterTypes<T>;
}

// We need to put this in a user message since some LLMs need
// at least one user message to function
function makeInstructionsMessage(instructions: string): string {
  return `
The user has given you the following task to complete:

\`\`\`
${instructions}
\`\`\`

Any additional messages provided are for providing context only and should not be used to ask questions or engage in conversation.
`;
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

They have also provided you with a function called extract you MUST call to initiate actions on their behalf.

Please assist them as best you can.

This is not a conversation, so please do not ask questions. Just call the function without saying anything else.
`;
}
