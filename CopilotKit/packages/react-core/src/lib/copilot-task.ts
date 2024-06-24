/**
 * Execute one-off tasks using Copilot intelligence.
 *
 * <img referrerPolicy="no-referrer-when-downgrade" src="https://static.scarf.sh/a.png?x-pxid=a9b290bb-38f9-4518-ac3b-8f54fdbf43be" />
 *
 * This class is used to execute one-off tasks, for example on button press. It
 * can use the context available via [useCopilotReadable](../useCopilotReadable)
 * and the actions provided by [useCopilotAction](../useCopilotAction), or
 * you can provide your own context and actions.
 *
 * <RequestExample>
 *   ```jsx CopilotTask Example
 *   import {
 *     CopilotTask,
 *     useCopilotContext
 *   } from "@copilotkit/react-core";
 *
 *   const task = new CopilotTask({
 *     instructions: "Set a random message",
 *     actions: [
 *       {
 *       name: "setMessage",
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
 *
 *       implementation: async (message) => {
 *         // ...
 *       },
 *     }
 *     ]
 *   });
 *   const context = useCopilotContext();
 *   await task.run(context);
 *   ```
 * </RequestExample>
 *
 * In the simplest case, use CopilotTask in the context of your app by giving it instructions on what to do.
 *
 * ```jsx
 * import {
 *     CopilotTask,
 *     useCopilotContext
 *   } from "@copilotkit/react-core";
 *
 * const randomSlideTask = new CopilotTask({
 *   instructions: "Make a random slide",
 * });
 *
 * const context = useCopilotContext();
 *
 * return (
 *   <button onClick={() => randomSlideTask.run(context)}>
 *     Make a random slide
 *   </button>
 * );
 * ```
 *
 * Have a look at the [Presentation example](https://github.com/CopilotKit/CopilotKit/blob/main/CopilotKit/examples/next-openai/src/app/presentation/page.tsx)
 * for a more complete example.
 *
 * It's also possible to provide your own context and actions. In addition, you can specify to ignore
 * `useCopilotReadable` and `useCopilotAction`.
 *
 * ```jsx
 * import {
 *     CopilotTask,
 *     useCopilotContext
 *   } from "@copilotkit/react-core";
 *
 * const standaloneTask = new CopilotTask({
 *   instructions: "Do something standalone",
 *   data: [...],
 *   actions: [...],
 *   includeCopilotReadable: false, // Don't use current context
 *   includeCopilotActions: false, // Don't use current actions
 * });
 *
 * const context = useCopilotContext();
 *
 * standaloneTask.run(context);
 * ```
 */

import {
  ActionExecutionMessage,
  CopilotRuntimeClient,
  Message,
  Role,
  TextMessage,
  convertGqlOutputToMessages,
  convertMessagesToGqlInput,
} from "@copilotkit/runtime-client-gql";
import { FrontendAction } from "../types/frontend-action";
import { CopilotContextParams } from "../context";
import { defaultCopilotContextCategories } from "../components";
import { MessageStatusCode } from "@copilotkit/runtime-client-gql";
import { actionParametersToJsonSchema } from "@copilotkit/shared";

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
   * @deprecated Use the `includeCopilotActions` property instead.
   */
  includeCopilotActionable?: boolean;

  /**
   * Whether to include actions defined via useCopilotAction in the task.
   */
  includeCopilotActions?: boolean;
}

export class CopilotTask<T = any> {
  private instructions: string;
  private actions: FrontendAction<any>[];
  private includeCopilotReadable: boolean;
  private includeCopilotActions: boolean;

  constructor(config: CopilotTaskConfig) {
    this.instructions = config.instructions;
    this.actions = config.actions || [];
    this.includeCopilotReadable = config.includeCopilotReadable !== false;
    this.includeCopilotActions =
      config.includeCopilotActions !== false && config.includeCopilotActionable !== false;
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
    });

    const response = await runtimeClient
      .runCopilotChat({
        frontend: {
          actions: Object.values(actions).map((action) => ({
            name: action.name,
            description: action.description || "",
            jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters || [])),
          })),
        },
        messages: convertMessagesToGqlInput(messages),
      })
      .toPromise();

    const functionCallHandler = context.getFunctionCallHandler(actions);
    const functionCalls = convertGqlOutputToMessages(
      response.data?.runCopilotChat?.messages || [],
    ).filter((m): m is ActionExecutionMessage => m instanceof ActionExecutionMessage);

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
