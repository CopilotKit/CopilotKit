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
import { RemoteChain, RemoteChainParameters, CopilotServiceAdapter } from "../../service-adapters";
import { MessageInput } from "../../graphql/inputs/message.input";
import { ActionInput } from "../../graphql/inputs/action.input";
import { RuntimeEventSource } from "../../service-adapters/events";
import { convertGqlInputToMessages } from "../../service-adapters/conversion";
import { Message } from "../../graphql/types/converted";
import {
  setupRemoteActions,
  RemoteActionDefinition,
  fetchRemoteActionLocations,
  executeAgent,
} from "./remote-actions";
import { GraphQLContext } from "../integrations/shared";

interface CopilotRuntimeRequest {
  serviceAdapter: CopilotServiceAdapter;
  messages: MessageInput[];
  actions: ActionInput[];
  outputMessagesPromise: Promise<Message[]>;
  threadId?: string;
  runId?: string;
  publicApiKey?: string;
  graphqlContext: GraphQLContext;
}

interface CopilotRuntimeResponse {
  threadId: string;
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
  inputMessages: Message[];
  properties: any;
}

type OnBeforeRequestHandler = (options: OnBeforeRequestOptions) => void | Promise<void>;

interface OnAfterRequestOptions {
  threadId: string;
  runId?: string;
  inputMessages: Message[];
  outputMessages: Message[];
  properties: any;
}

type OnAfterRequestHandler = (options: OnAfterRequestOptions) => void | Promise<void>;

interface Middleware {
  /**
   * A function that is called before the request is processed.
   */
  onBeforeRequest?: OnBeforeRequestHandler;

  /**
   * A function that is called after the request is processed.
   */
  onAfterRequest?: OnAfterRequestHandler;
}

export interface CopilotRuntimeConstructorParams<T extends Parameter[] | [] = []> {
  /**
   * Middleware to be used by the runtime.
   *
   * ```ts
   * onBeforeRequest: (options: {
   *   threadId?: string;
   *   runId?: string;
   *   inputMessages: Message[];
   *   properties: any;
   * }) => void | Promise<void>;
   * ```
   *
   * ```ts
   * onAfterRequest: (options: {
   *   threadId?: string;
   *   runId?: string;
   *   inputMessages: Message[];
   *   outputMessages: Message[];
   *   properties: any;
   * }) => void | Promise<void>;
   * ```
   */
  middleware?: Middleware;

  /*
   * A list of server side actions that can be executed.
   */
  actions?: ActionsConfiguration<T>;

  /*
   * A list of remote actions that can be executed.
   */
  remoteActions?: RemoteActionDefinition[];

  /*
   * An array of LangServer URLs.
   */
  langserve?: RemoteChainParameters[];
}

export class CopilotRuntime<const T extends Parameter[] | [] = []> {
  public actions: ActionsConfiguration<T>;
  private remoteActionDefinitions: RemoteActionDefinition[];
  private langserve: Promise<Action<any>>[] = [];
  private onBeforeRequest?: OnBeforeRequestHandler;
  private onAfterRequest?: OnAfterRequestHandler;

  constructor(params?: CopilotRuntimeConstructorParams<T>) {
    this.actions = params?.actions || [];

    for (const chain of params?.langserve || []) {
      const remoteChain = new RemoteChain(chain);
      this.langserve.push(remoteChain.toAction());
    }

    this.remoteActionDefinitions = params?.remoteActions || [];

    this.onBeforeRequest = params?.middleware?.onBeforeRequest;
    this.onAfterRequest = params?.middleware?.onAfterRequest;
  }

  async processAgentRequest(request: CopilotRuntimeRequest): Promise<CopilotRuntimeResponse> {
    const { messages, outputMessagesPromise, graphqlContext } = request;

    const message = request.messages.slice(-1)[0].agentMessage!;

    const agentName = message.agentName;
    const threadId = message.threadId;
    const state = message.state;

    // Fetch remote actions
    const remoteActions = await fetchRemoteActionLocations({
      remoteActionDefinitions: this.remoteActionDefinitions,
      graphqlContext,
    });

    const url = remoteActions.get(agentName);
    if (!url) {
      throw new Error(`Action location for agent name ${agentName} not found.`);
    }

    const inputMessages = convertGqlInputToMessages(messages);

    await this.onBeforeRequest?.({
      threadId,
      runId: undefined,
      inputMessages,
      properties: graphqlContext.properties,
    });
    try {
      const eventSource = new RuntimeEventSource();

      const result = await executeAgent({
        agentName,
        threadId,
        state,
        url,
        graphqlContext,
        logger: graphqlContext.logger,
      });

      eventSource.stream(async (eventStream$) => {
        eventStream$.sendAgentMessage(result.threadId, agentName, result.state, result.running);
      });

      outputMessagesPromise
        .then((outputMessages) => {
          this.onAfterRequest?.({
            threadId: result.threadId,
            runId: undefined,
            inputMessages,
            outputMessages,
            properties: graphqlContext.properties,
          });
        })
        .catch((_error) => {});

      return {
        threadId: result.threadId,
        runId: undefined,
        eventSource,
        actions: [],
      };
    } catch (error) {
      console.error("Error getting response:", error);
      throw error;
    }
  }

  async process(request: CopilotRuntimeRequest): Promise<CopilotRuntimeResponse> {
    if (request.messages.length > 0) {
      const [lastMessage] = request.messages.slice(-1);
      if (lastMessage.agentMessage) {
        return this.processAgentRequest(request);
      }
    }

    const {
      serviceAdapter,
      messages: rawMessages,
      actions: clientSideActionsInput,
      threadId,
      runId,
      outputMessagesPromise,
      graphqlContext,
    } = request;

    const messages = rawMessages.filter((message) => !message.agentMessage);
    const langserveFunctions: Action<any>[] = [];

    for (const chainPromise of this.langserve) {
      try {
        const chain = await chainPromise;
        langserveFunctions.push(chain);
      } catch (error) {
        console.error("Error loading langserve chain:", error);
      }
    }

    // Fetch remote actions
    const remoteActions = await setupRemoteActions({
      remoteActionDefinitions: this.remoteActionDefinitions,
      graphqlContext,
    });

    const configuredActions =
      typeof this.actions === "function"
        ? this.actions({ properties: graphqlContext.properties })
        : this.actions;

    const actions = [...configuredActions, ...langserveFunctions, ...remoteActions];

    const serverSideActionsInput: ActionInput[] = actions.map((action) => ({
      name: action.name,
      description: action.description,
      jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters)),
    }));

    const actionInputs = flattenToolCallsNoDuplicates([
      ...serverSideActionsInput,
      ...clientSideActionsInput,
    ]);
    const inputMessages = convertGqlInputToMessages(messages);

    await this.onBeforeRequest?.({
      threadId,
      runId,
      inputMessages,
      properties: graphqlContext.properties,
    });

    try {
      const eventSource = new RuntimeEventSource();

      const result = await serviceAdapter.process({
        messages: inputMessages,
        actions: actionInputs,
        threadId,
        runId,
        eventSource,
      });

      outputMessagesPromise
        .then((outputMessages) => {
          this.onAfterRequest?.({
            threadId: result.threadId,
            runId: result.runId,
            inputMessages,
            outputMessages,
            properties: graphqlContext.properties,
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
