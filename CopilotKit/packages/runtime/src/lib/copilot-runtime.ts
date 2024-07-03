/**
 * Handles requests from frontend, provides function calling and various LLM backends.
 *
 * <img
 *   referrerPolicy="no-referrer-when-downgrade"
 *   src="https://static.scarf.sh/a.png?x-pxid=a9b290bb-38f9-4518-ac3b-8f54fdbf43be"
 * />
 *
 * <RequestExample>
 *   ```jsx CopilotRuntime Example
 *   import {
 *     CopilotRuntime,
 *     OpenAIAdapter
 *   } from "@copilotkit/runtime";
 *
 *   export async function POST(req: Request) {
 *     const copilotKit = new CopilotRuntime();
 *     return copilotKit.response(req, new OpenAIAdapter());
 *   }
 *
 * ```
 * </RequestExample>
 *
 * This class is the main entry point for the runtime. It handles requests from the frontend, provides function calling and various LLM backends.
 *
 * For example, to use OpenAI as a backend (check the [OpenAI Adapter](./OpenAIAdapter) docs for more info):
 * ```typescript
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new OpenAIAdapter());
 * ```
 *
 * Currently we support:
 *
 * - [OpenAI](./OpenAIAdapter)
 * - [LangChain](./LangChainAdapter)
 * - [OpenAI Assistant API](./OpenAIAssistantAdapter)
 * - [Google Gemini](./GoogleGenerativeAIAdapter)
 *
 * ## Server Side Actions
 *
 * CopilotKit supports actions that can be executed on the server side. You can define server side actions by passing the `actions` parameter:
 *
 * ```typescript
 * const copilotKit = new CopilotRuntime({
 *   actions: [
 *     {
 *       name: "sayHello",
 *       description: "Says hello to someone.",
 *       argumentAnnotations: [
 *         {
 *           name: "arg",
 *           type: "string",
 *           description: "The name of the person to say hello to.",
 *           required: true,
 *         },
 *       ],
 *       implementation: async (arg) => {
 *         console.log("Hello from the server", arg, "!");
 *       },
 *     },
 *   ],
 * });
 * ```
 *
 * Server side actions can also return a result which becomes part of the message history.
 *
 * This is useful because it gives the LLM context about what happened on the server side. In addition,
 * it can be used to look up information from a vector or relational database and other sources.
 *
 * In addition to that, server side actions can also come from LangChain, including support for streaming responses.
 *
 * Returned results can be of the following type:
 *
 * - anything serializable to JSON
 * - `string`
 * - LangChain types:
 *   - `IterableReadableStream`
 *   - `BaseMessageChunk`
 *   - `AIMessage`
 *
 * ## LangServe
 *
 * The backend also supports LangServe, enabling you to connect to existing chains, for example python based chains.
 * Use the `langserve` parameter to specify URLs for LangServe.
 *
 * ```typescript
 * const copilotKit = new CopilotRuntime({
 *   langserve: [
 *     {
 *       chainUrl: "http://my-langserve.chain",
 *       name: "performResearch",
 *       description: "Performs research on a given topic.",
 *     },
 *   ],
 * });
 * ```
 *
 * When left out, arguments are automatically inferred from the schema provided by LangServe.
 */

import { Action, actionParametersToJsonSchema, Parameter } from "@copilotkit/shared";
import { RemoteChain, RemoteChainParameters, CopilotServiceAdapter } from "../service-adapters";
import { MessageInput } from "../graphql/inputs/message.input";
import { ActionInput } from "../graphql/inputs/action.input";
import { RuntimeEventSource } from "../service-adapters/events";
import { convertGqlInputToMessages } from "../service-adapters/conversion";
import { Message } from "../graphql/types/converted";

interface CopilotRuntimeRequest {
  serviceAdapter: CopilotServiceAdapter;
  messages: MessageInput[];
  actions: ActionInput[];
  outputMessagesPromise: Promise<Message[]>;
  properties: any;
  threadId?: string;
  runId?: string;
  publicApiKey?: string;
}

interface CopilotRuntimeResponse {
  threadId?: string;
  runId?: string;
  eventSource: RuntimeEventSource;
  actions: Action<any>[];
}

type ActionsConfiguration<T extends Parameter[] | [] = []> =
  | Action<T>[]
  | ((ctx: { properties: any }) => Action<T>[]);

interface OnBeforeRequestOptions {
  threadId?: string;
  runId?: string;
  messages: Message[];
  properties: any;
}

type OnBeforeRequestHandler = (options: OnBeforeRequestOptions) => void | Promise<void>;

interface OnAfterRequestOptions {
  threadId?: string;
  runId?: string;
  messages: Message[];
  properties: any;
}

type OnAfterRequestHandler = (options: OnAfterRequestOptions) => void | Promise<void>;

export interface CopilotRuntimeConstructorParams<T extends Parameter[] | [] = []> {
  /**
   * A function that is called before the request is processed.
   */
  onBeforeRequest?: OnBeforeRequestHandler;

  /**
   * A function that is called after the request is processed.
   */
  onAfterRequest?: OnAfterRequestHandler;

  /*
   * A list of server side actions that can be executed.
   */
  actions?: ActionsConfiguration<T>;

  /*
   * An array of LangServer URLs.
   */
  langserve?: RemoteChainParameters[];
}

export class CopilotRuntime<const T extends Parameter[] | [] = []> {
  public actions: ActionsConfiguration<T>;
  private langserve: Promise<Action<any>>[] = [];
  private onBeforeRequest?: OnBeforeRequestHandler;
  private onAfterRequest?: OnAfterRequestHandler;

  constructor(params?: CopilotRuntimeConstructorParams<T>) {
    this.actions = params?.actions || [];

    for (const chain of params?.langserve || []) {
      const remoteChain = new RemoteChain(chain);
      this.langserve.push(remoteChain.toAction());
    }

    this.onBeforeRequest = params?.onBeforeRequest;
    this.onAfterRequest = params?.onAfterRequest;
  }

  async process({
    serviceAdapter,
    messages,
    actions: clientSideActionsInput,
    threadId,
    runId,
    properties,
    outputMessagesPromise,
  }: CopilotRuntimeRequest): Promise<CopilotRuntimeResponse> {
    const langserveFunctions: Action<any>[] = [];

    for (const chainPromise of this.langserve) {
      try {
        const chain = await chainPromise;
        langserveFunctions.push(chain);
      } catch (error) {
        console.error("Error loading langserve chain:", error);
      }
    }

    const configuredActions =
      typeof this.actions === "function" ? this.actions({ properties }) : this.actions;

    const actions = [...configuredActions, ...langserveFunctions];

    const serverSideActionsInput: ActionInput[] = actions.map((action) => ({
      name: action.name,
      description: action.description,
      jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters)),
    }));

    const actionInputs = flattenToolCallsNoDuplicates([
      ...serverSideActionsInput,
      ...clientSideActionsInput,
    ]);
    const convertedMessages = convertGqlInputToMessages(messages);

    await this.onBeforeRequest?.({
      threadId,
      runId,
      messages: convertedMessages,
      properties,
    });

    try {
      const eventSource = new RuntimeEventSource();

      const result = await serviceAdapter.process({
        messages: convertedMessages,
        actions: actionInputs,
        threadId,
        runId,
        eventSource,
      });

      outputMessagesPromise
        .then((messages) => {
          this.onAfterRequest?.({
            threadId: result.threadId,
            runId: result.runId,
            messages,
            properties,
          });
        })
        .catch((_error) => {});

      return {
        threadId: result.threadId,
        runId: result.runId,
        eventSource,
        actions: actions,
      };
    } catch (error) {
      console.error("Error getting response:", error);
      throw error;
    }
  }
}

export function flattenToolCallsNoDuplicates(toolsByPriority: ActionInput[]): ActionInput[] {
  let allTools: ActionInput[] = [];
  const allToolNames: string[] = [];
  for (const tool of toolsByPriority) {
    if (!allToolNames.includes(tool.name)) {
      allTools.push(tool);
      allToolNames.push(tool.name);
    }
  }
  return allTools;
}
