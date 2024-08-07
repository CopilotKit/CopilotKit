/**
 * <Callout type="info">
 *   This is the reference for the `CopilotRuntime` class. For more information and example code snippets, please see [Concept: Copilot Runtime](/concepts/copilot-runtime).
 * </Callout>
 *
 * ## Usage
 *
 * ```tsx
 * import { CopilotRuntime } from "@copilotkit/runtime";
 *
 * const copilotKit = new CopilotRuntime();
 * ```
 */

import { Action, actionParametersToJsonSchema, Parameter } from "@copilotkit/shared";
import { RemoteChain, RemoteChainParameters, CopilotServiceAdapter } from "../../service-adapters";
import { MessageInput } from "../../graphql/inputs/message.input";
import { ActionInput } from "../../graphql/inputs/action.input";
import { RuntimeEventSource } from "../../service-adapters/events";
import { convertGqlInputToMessages } from "../../service-adapters/conversion";
import { Message } from "../../graphql/types/converted";
import { ForwardedParametersInput } from "../../graphql/inputs/forwarded-parameters.input";
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
  forwardedParameters?: ForwardedParametersInput;
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
    const state = JSON.parse(message.state);
    const nodeName = message.nodeName;

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
        nodeName,
        threadId,
        state,
        url,
        graphqlContext,
        logger: graphqlContext.logger,
      });

      eventSource.stream(async (eventStream$) => {
        eventStream$.sendAgentMessage(
          result.threadId,
          agentName,
          result.nodeName,
          result.state,
          result.running,
        );
        eventStream$.complete();
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
      forwardedParameters,
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
        forwardedParameters,
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
