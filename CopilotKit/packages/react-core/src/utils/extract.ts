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
  try {
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
    let hasStructuredError = false;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (abortSignal?.aborted) {
        throw new Error("Aborted");
      }

      // Check for structured error in response status before processing messages
      if (value?.generateCopilotResponse?.status?.__typename === "FailedResponseStatus") {
        const failedStatus = value.generateCopilotResponse.status as any;
        if (failedStatus.reason === "STRUCTURED_ERROR") {
          const categorizedError = failedStatus.details?.categorizedError;
          if (categorizedError) {
            hasStructuredError = true;
            // Create error with the categorized error data embedded
            const structuredError = new Error(categorizedError.message || "Runtime error occurred");
            (structuredError as any).extensions = { categorizedError };

            // Route through error handler if available
            if (context.handleError) {
              await context.handleError(structuredError, {
                componentName: "extract",
                actionName: "extract",
              });
            }

            throw structuredError;
          }
        }
      }

      actionExecutionMessage = convertGqlOutputToMessages(
        value.generateCopilotResponse.messages,
      ).find((msg) => msg.isActionExecutionMessage()) as ActionExecutionMessage | undefined;

      if (!actionExecutionMessage) {
        continue;
      }

      stream?.({
        status: isInitial ? "initial" : "inProgress",
        args: actionExecutionMessage.arguments as Partial<MappedParameterTypes<T>>,
      });

      isInitial = false;
    }

    if (!actionExecutionMessage && !hasStructuredError) {
      // Only create generic extract error if there was no underlying runtime error
      const extractError = new Error(
        "extract() failed: No function call occurred. This often indicates an underlying runtime error (e.g., LLM API authentication failure, network issues, or agent execution problems). Check your runtime logs for the actual error details.",
      );

      // Route through error handler if available
      if (context.handleError) {
        await context.handleError(extractError, {
          componentName: "extract",
          actionName: "extract",
        });
      }

      throw extractError;
    } else if (!actionExecutionMessage && hasStructuredError) {
      // If we had a structured error, it should have already been thrown above
      // This shouldn't normally happen, but just in case:
      throw new Error("Runtime error occurred (structured error was processed but not thrown)");
    }

    // TypeScript guard: actionExecutionMessage is guaranteed to exist here
    if (!actionExecutionMessage) {
      throw new Error("Unexpected state: actionExecutionMessage is undefined");
    }

    stream?.({
      status: "complete",
      args: actionExecutionMessage.arguments as MappedParameterTypes<T>,
    });

    return actionExecutionMessage.arguments as MappedParameterTypes<T>;
  } catch (error) {
    // Check if this is a GraphQL error with embedded categorized error data from runtime
    if (error && typeof error === "object" && "extensions" in error) {
      const extensions = (error as any).extensions;
      if (extensions?.categorizedError) {
        // This error already has runtime categorization, just pass it through to error handler
        if (context.handleError) {
          await context.handleError(error, {
            componentName: "extract",
            actionName: "extract",
          });
        }
        throw error;
      }
    }

    // For other errors (including stream/network errors), let the error handler categorize them
    if (context.handleError) {
      await context.handleError(error, {
        componentName: "extract",
        actionName: "extract",
      });
    }

    // Re-throw the error so the calling code can handle it appropriately
    throw error;
  }
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
