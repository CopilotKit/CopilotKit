/**
 * This class is used to execute one-off tasks, for example on button press. It can use the context available via [useCopilotReadable](/reference/hooks/useCopilotReadable) and the actions provided by [useCopilotAction](/reference/hooks/useCopilotAction), or you can provide your own context and actions.
 *
 * ## Example
 * In the simplest case, use CopilotTask in the context of your app by giving it instructions on what to do.
 *
 * ```tsx
 * import { CopilotTask, useCopilotContext } from "@copilotkit/react-core";
 *
 * export function MyComponent() {
 *   const context = useCopilotContext();
 *
 *   const task = new CopilotTask({
 *     instructions: "Set a random message",
 *     actions: [
 *       {
 *         name: "setMessage",
 *       description: "Set the message.",
 *       argumentAnnotations: [
 *         {
 *           name: "message",
 *           type: "string",
 *           description:
 *             "A message to display.",
 *           required: true,
 *         },
 *       ],
 *      }
 *     ]
 *   });
 *
 *   const executeTask = async () => {
 *     await task.run(context, action);
 *   }
 *
 *   return (
 *     <>
 *       <button onClick={executeTask}>
 *         Execute task
 *       </button>
 *     </>
 *   )
 * }
 * ```
 *
 * Have a look at the [Presentation Example App](https://github.com/CopilotKit/CopilotKit/blob/main/CopilotKit/examples/next-openai/src/app/presentation/page.tsx) for a more complete example.
 */

import {
  ActionExecutionMessage,
  CopilotRuntimeClient,
  Message,
  Role,
  TextMessage,
  convertGqlOutputToMessages,
  convertMessagesToGqlInput,
  filterAgentStateMessages,
  CopilotRequestType,
  ForwardedParametersInput,
} from "@copilotkit/runtime-client-gql";
import { FrontendAction, processActionsForRuntimeRequest } from "../types/frontend-action";
import { CopilotContextParams } from "../context";
import { defaultCopilotContextCategories } from "../components";

export interface CopilotTaskConfig {
  /**
   * The instructions to be given to the assistant.
   */
  instructions: string;
  /**
   * An array of action definitions that can be called.
   */
  actions?: FrontendAction<any>[];
  /**
   * Whether to include the copilot readable context in the task.
   */
  includeCopilotReadable?: boolean;

  /**
   * Whether to include actions defined via useCopilotAction in the task.
   */
  includeCopilotActions?: boolean;

  /**
   * The forwarded parameters to use for the task.
   */
  forwardedParameters?: ForwardedParametersInput;
}

export class CopilotTask<T = any> {
  private instructions: string;
  private actions: FrontendAction<any>[];
  private includeCopilotReadable: boolean;
  private includeCopilotActions: boolean;
  private forwardedParameters?: ForwardedParametersInput;
  constructor(config: CopilotTaskConfig) {
    this.instructions = config.instructions;
    this.actions = config.actions || [];
    this.includeCopilotReadable = config.includeCopilotReadable !== false;
    this.includeCopilotActions = config.includeCopilotActions !== false;
    this.forwardedParameters = config.forwardedParameters;
  }

  /**
   * Run the task.
   * @param context The CopilotContext to use for the task. Use `useCopilotContext` to obtain the current context.
   * @param data The data to use for the task.
   */
  async run(context: CopilotContextParams, data?: T): Promise<void> {
    const actions = this.includeCopilotActions ? Object.assign({}, context.actions) : {};

    // merge functions into entry points
    for (const fn of this.actions) {
      actions[fn.name] = fn;
    }

    let contextString = "";

    if (data) {
      contextString = (typeof data === "string" ? data : JSON.stringify(data)) + "\n\n";
    }

    if (this.includeCopilotReadable) {
      contextString += context.getContextString([], defaultCopilotContextCategories);
    }

    const systemMessage = new TextMessage({
      content: taskSystemMessage(contextString, this.instructions),
      role: Role.System,
    });

    const messages: Message[] = [systemMessage];

    const runtimeClient = new CopilotRuntimeClient({
      url: context.copilotApiConfig.chatApiEndpoint,
      publicApiKey: context.copilotApiConfig.publicApiKey,
      headers: context.copilotApiConfig.headers,
      credentials: context.copilotApiConfig.credentials,
    });

    const response = await runtimeClient
      .generateCopilotResponse({
        data: {
          frontend: {
            actions: processActionsForRuntimeRequest(Object.values(actions)),
            url: window.location.href,
          },
          messages: convertMessagesToGqlInput(filterAgentStateMessages(messages)),
          metadata: {
            requestType: CopilotRequestType.Task,
          },
          forwardedParameters: {
            // if forwardedParameters is provided, use it
            toolChoice: "required",
            ...(this.forwardedParameters ?? {}),
          },
        },
        properties: context.copilotApiConfig.properties,
      })
      .toPromise();

    const functionCallHandler = context.getFunctionCallHandler(actions);
    const functionCalls = convertGqlOutputToMessages(
      response.data?.generateCopilotResponse?.messages || [],
    ).filter((m): m is ActionExecutionMessage => m.isActionExecutionMessage());

    for (const functionCall of functionCalls) {
      await functionCallHandler({
        messages,
        name: functionCall.name,
        args: functionCall.arguments,
      });
    }
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
