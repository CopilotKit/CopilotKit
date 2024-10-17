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

import { Action, actionParametersToJsonSchema, Parameter, randomId } from "@copilotkit/shared";
import { CopilotServiceAdapter, RemoteChain, RemoteChainParameters } from "../../service-adapters";
import { MessageInput } from "../../graphql/inputs/message.input";
import { ActionInput } from "../../graphql/inputs/action.input";
import { RuntimeEventSource } from "../../service-adapters/events";
import { convertGqlInputToMessages } from "../../service-adapters/conversion";
import { Message } from "../../graphql/types/converted";
import { ForwardedParametersInput } from "../../graphql/inputs/forwarded-parameters.input";
import {
  isLangGraphAgentAction,
  LangGraphAgentAction,
  RemoteAction,
  RemoteEndpointDefinition,
  RemoteEndpointType,
  RemoteLangGraphCloudAction,
  setupRemoteActions,
} from "./remote-actions";
import { GraphQLContext } from "../integrations/shared";
import { AgentSessionInput } from "../../graphql/inputs/agent-session.input";
import { from } from "rxjs";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";

interface CopilotRuntimeRequest {
  serviceAdapter: CopilotServiceAdapter;
  messages: MessageInput[];
  actions: ActionInput[];
  agentSession?: AgentSessionInput;
  agentStates?: AgentStateInput[];
  outputMessagesPromise: Promise<Message[]>;
  threadId?: string;
  runId?: string;
  publicApiKey?: string;
  graphqlContext: GraphQLContext;
  forwardedParameters?: ForwardedParametersInput;
  url?: string;
}

interface CopilotRuntimeResponse {
  threadId: string;
  runId?: string;
  eventSource: RuntimeEventSource;
  serverSideActions: Action<any>[];
  actionInputsWithoutAgents: ActionInput[];
}

type ActionsConfiguration<T extends Parameter[] | [] = []> =
  | Action<T>[]
  | ((ctx: { properties: any; url?: string }) => Action<T>[]);

interface OnBeforeRequestOptions {
  threadId?: string;
  runId?: string;
  inputMessages: Message[];
  properties: any;
  url?: string;
}

type OnBeforeRequestHandler = (options: OnBeforeRequestOptions) => void | Promise<void>;

interface OnAfterRequestOptions {
  threadId: string;
  runId?: string;
  inputMessages: Message[];
  outputMessages: Message[];
  properties: any;
  url?: string;
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
   * Deprecated: See `remoteEndpoints`.
   */
  remoteActions?: RemoteEndpointDefinition[];

  /*
   * A list of remote actions that can be executed.
   */
  remoteEndpoints?: RemoteEndpointDefinition[];

  /*
   * An array of LangServer URLs.
   */
  langserve?: RemoteChainParameters[];
}

export class CopilotRuntime<const T extends Parameter[] | [] = []> {
  public actions: ActionsConfiguration<T>;
  private remoteEndpointDefinitions: RemoteEndpointDefinition[];
  private langserve: Promise<Action<any>>[] = [];
  private onBeforeRequest?: OnBeforeRequestHandler;
  private onAfterRequest?: OnAfterRequestHandler;

  constructor(params?: CopilotRuntimeConstructorParams<T>) {
    this.actions = params?.actions || [];

    for (const chain of params?.langserve || []) {
      const remoteChain = new RemoteChain(chain);
      this.langserve.push(remoteChain.toAction());
    }

    this.remoteEndpointDefinitions = params?.remoteEndpoints || [];

    this.onBeforeRequest = params?.middleware?.onBeforeRequest;
    this.onAfterRequest = params?.middleware?.onAfterRequest;
  }

  async processRuntimeRequest(request: CopilotRuntimeRequest): Promise<CopilotRuntimeResponse> {
    const {
      serviceAdapter,
      messages: rawMessages,
      actions: clientSideActionsInput,
      threadId,
      runId,
      outputMessagesPromise,
      graphqlContext,
      forwardedParameters,
      agentSession,
      url,
    } = request;

    if (agentSession) {
      return this.processAgentRequest(request);
    }

    const messages = rawMessages.filter((message) => !message.agentStateMessage);

    const inputMessages = convertGqlInputToMessages(messages);
    const serverSideActions = await this.getServerSideActions(request);

    const serverSideActionsInput: ActionInput[] = serverSideActions.map((action) => ({
      name: action.name,
      description: action.description,
      jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters)),
    }));

    const actionInputs = flattenToolCallsNoDuplicates([
      ...serverSideActionsInput,
      ...clientSideActionsInput,
    ]);

    await this.onBeforeRequest?.({
      threadId,
      runId,
      inputMessages,
      properties: graphqlContext.properties,
      url,
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
            url,
          });
        })
        .catch((_error) => {});

      return {
        threadId: result.threadId,
        runId: result.runId,
        eventSource,
        serverSideActions,
        actionInputsWithoutAgents: actionInputs.filter(
          (action) =>
            // TODO-AGENTS: do not exclude ALL server side actions
            !serverSideActions.find((serverSideAction) => serverSideAction.name == action.name),
          // !isLangGraphAgentAction(
          //   serverSideActions.find((serverSideAction) => serverSideAction.name == action.name),
          // ),
        ),
      };
    } catch (error) {
      console.error("Error getting response:", error);
      throw error;
    }
  }

  private async processAgentRequest(
    request: CopilotRuntimeRequest,
  ): Promise<CopilotRuntimeResponse> {
    const { messages: rawMessages, outputMessagesPromise, graphqlContext, agentSession } = request;
    const { threadId, agentName, nodeName } = agentSession;
    const serverSideActions = await this.getServerSideActions(request);

    const messages = convertGqlInputToMessages(rawMessages);

    const agent = serverSideActions.find(
      (action) => action.name === agentName && isLangGraphAgentAction(action),
    ) as LangGraphAgentAction;

    if (!agent) {
      throw new Error(`Agent ${agentName} not found`);
    }

    const serverSideActionsInput: ActionInput[] = serverSideActions
      .filter((action) => !isLangGraphAgentAction(action))
      .map((action) => ({
        name: action.name,
        description: action.description,
        jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters)),
      }));

    const actionInputsWithoutAgents = flattenToolCallsNoDuplicates([
      ...serverSideActionsInput,
      ...request.actions,
    ]);

    await this.onBeforeRequest?.({
      threadId,
      runId: undefined,
      inputMessages: messages,
      properties: graphqlContext.properties,
    });
    try {
      const eventSource = new RuntimeEventSource();
      const stream = await agent.langGraphAgentHandler({
        name: agentName,
        threadId,
        nodeName,
        actionInputsWithoutAgents,
      });

      eventSource.stream(async (eventStream$) => {
        from(stream).subscribe({
          next: (event) => eventStream$.next(event),
          error: (err) => console.error("Error in stream", err),
          complete: () => eventStream$.complete(),
        });
      });

      outputMessagesPromise
        .then((outputMessages) => {
          this.onAfterRequest?.({
            threadId,
            runId: undefined,
            inputMessages: messages,
            outputMessages,
            properties: graphqlContext.properties,
          });
        })
        .catch((_error) => {});

      return {
        threadId,
        runId: undefined,
        eventSource,
        serverSideActions: [],
        actionInputsWithoutAgents,
      };
    } catch (error) {
      console.error("Error getting response:", error);
      throw error;
    }
  }

  private async getServerSideActions(request: CopilotRuntimeRequest): Promise<Action<any>[]> {
    const { messages: rawMessages, graphqlContext, agentStates, url } = request;
    const inputMessages = convertGqlInputToMessages(rawMessages);
    const langserveFunctions: Action<any>[] = [];

    for (const chainPromise of this.langserve) {
      try {
        const chain = await chainPromise;
        langserveFunctions.push(chain);
      } catch (error) {
        console.error("Error loading langserve chain:", error);
      }
    }

    const remoteEndpointDefinitions = this.remoteEndpointDefinitions.map(
      (endpoint) =>
        ({
          ...endpoint,
          type: this.resolveRemoteEndpointType(endpoint),
        }) as RemoteEndpointDefinition,
    );

    const remoteActions = await setupRemoteActions({
      remoteEndpointDefinitions,
      graphqlContext,
      messages: inputMessages,
      agentStates,
      frontendUrl: url,
    });

    const configuredActions =
      typeof this.actions === "function"
        ? this.actions({ properties: graphqlContext.properties, url })
        : this.actions;

    return [...configuredActions, ...langserveFunctions, ...remoteActions];
  }

  private resolveRemoteEndpointType(action: RemoteEndpointDefinition) {
    if (
      !action.type &&
      "langsmithApiKey" in action &&
      "deploymentUrl" in action &&
      "agents" in action
    ) {
      return RemoteEndpointType.LangGraphCloud;
    }

    return action.type;
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

// The two functions below are "factory functions", meant to create the action objects that adhere to the expected interfaces
export function remoteAction(action: Omit<RemoteAction, "type">): RemoteAction {
  return {
    ...action,
    type: RemoteEndpointType.Remote,
  };
}

export function remoteLangGraphCloudAction(
  action: Omit<RemoteLangGraphCloudAction, "type">,
): RemoteLangGraphCloudAction {
  return {
    ...action,
    type: RemoteEndpointType.LangGraphCloud,
  };
}
