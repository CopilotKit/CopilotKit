import { Action } from "@copilotkit/shared";
import { GraphQLContext } from "../integrations/shared";
import { Logger } from "pino";
import telemetry from "../../lib/telemetry-client";
import { Message } from "../../graphql/types/converted";
import { RuntimeEvent } from "../../service-adapters/events";
import { RemoteLangGraphEventSource } from "../../agents/langgraph/event-source";
import { Observable, ReplaySubject } from "rxjs";
import { ActionInput } from "../../graphql/inputs/action.input";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";
import { LangGraphEvent } from "../../agents/langgraph/events";

export type RemoteActionDefinition = RemoteAction | RemoteLangGraphCloudAction;

export enum RemoteActionType {
  Remote = "remote",
  LangGraphCloud = "langgraph-cloud",
}

export interface BaseRemoteActionDefinition<TActionType extends RemoteActionType> {
  type?: TActionType;
}

export interface RemoteAction extends BaseRemoteActionDefinition<RemoteActionType.Remote> {
  url: string;
  onBeforeRequest?: ({ ctx }: { ctx: GraphQLContext }) => {
    headers?: Record<string, string> | undefined;
  };
}

export interface RemoteLangGraphAgent {
  name: string;
  description: string;
  assistantId?: string;
}

export interface RemoteLangGraphCloudAction
  extends BaseRemoteActionDefinition<RemoteActionType.LangGraphCloud> {
  deploymentUrl: string;
  langsmithApiKey: string;
  agents: RemoteLangGraphAgent[];
}

export type RemoteActionInfoResponse = {
  actions: any[];
  agents: any[];
};

export type LangGraphAgentHandlerParams = {
  name: string;
  actionInputsWithoutAgents: ActionInput[];
  threadId?: string;
  nodeName?: string;
};

export type LangGraphAgentAction = Action<any> & {
  langGraphAgentHandler: (params: LangGraphAgentHandlerParams) => Promise<Observable<RuntimeEvent>>;
};

export function isLangGraphAgentAction(action: Action<any>): action is LangGraphAgentAction {
  if (!action) {
    return false;
  }
  return typeof (action as LangGraphAgentAction).langGraphAgentHandler === "function";
}

function createHeaders(
  onBeforeRequest: RemoteAction["onBeforeRequest"],
  graphqlContext: GraphQLContext,
) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (onBeforeRequest) {
    const { headers: additionalHeaders } = onBeforeRequest({ ctx: graphqlContext });
    if (additionalHeaders) {
      Object.assign(headers, additionalHeaders);
    }
  }

  return headers;
}

async function fetchRemoteInfo({
  url,
  onBeforeRequest,
  graphqlContext,
  logger,
  frontendUrl,
}: {
  url: string;
  onBeforeRequest?: RemoteAction["onBeforeRequest"];
  graphqlContext: GraphQLContext;
  logger: Logger;
  frontendUrl?: string;
}): Promise<RemoteActionInfoResponse> {
  logger.debug({ url }, "Fetching actions from url");
  const headers = createHeaders(onBeforeRequest, graphqlContext);

  try {
    const response = await fetch(`${url}/info`, {
      method: "POST",
      headers,
      body: JSON.stringify({ properties: graphqlContext.properties, frontendUrl }),
    });

    if (!response.ok) {
      logger.error(
        { url, status: response.status, body: await response.text() },
        "Failed to fetch actions from url",
      );
      return { actions: [], agents: [] };
    }

    const json = await response.json();
    logger.debug({ json }, "Fetched actions from url");
    return json;
  } catch (error) {
    logger.error(
      { error: error.message ? error.message : error + "" },
      "Failed to fetch actions from url",
    );
    return { actions: [], agents: [] };
  }
}

function constructRemoteActions({
  json,
  url,
  onBeforeRequest,
  graphqlContext,
  logger,
  messages,
  agentStates,
}: {
  json: RemoteActionInfoResponse;
  url: string;
  onBeforeRequest?: RemoteAction["onBeforeRequest"];
  graphqlContext: GraphQLContext;
  logger: Logger;
  messages: Message[];
  agentStates?: AgentStateInput[];
}): Action<any>[] {
  const actions = json["actions"].map((action) => ({
    name: action.name,
    description: action.description,
    parameters: action.parameters,
    handler: async (args: any) => {
      logger.debug({ actionName: action.name, args }, "Executing remote action");

      const headers = createHeaders(onBeforeRequest, graphqlContext);
      telemetry.capture("oss.runtime.remote_action_executed", {});

      try {
        const response = await fetch(`${url}/actions/execute`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: action.name,
            arguments: args,
            properties: graphqlContext.properties,
          }),
        });

        if (!response.ok) {
          logger.error(
            { url, status: response.status, body: await response.text() },
            "Failed to execute remote action",
          );
          return "Failed to execute remote action";
        }

        const requestResult = await response.json();

        const result = requestResult["result"];
        logger.debug({ actionName: action.name, result }, "Executed remote action");
        return result;
      } catch (error) {
        logger.error(
          { error: error.message ? error.message : error + "" },
          "Failed to execute remote action",
        );
        return "Failed to execute remote action";
      }
    },
  }));

  const agents = json["agents"].map((agent) => ({
    name: agent.name,
    description: agent.description,
    parameters: [],
    handler: async (_args: any) => {},

    langGraphAgentHandler: async ({
      name,
      actionInputsWithoutAgents,
      threadId,
      nodeName,
    }: LangGraphAgentHandlerParams): Promise<Observable<RuntimeEvent>> => {
      logger.debug({ actionName: agent.name }, "Executing remote agent");

      const headers = createHeaders(onBeforeRequest, graphqlContext);
      telemetry.capture("oss.runtime.remote_action_executed", {});

      let state = {};
      if (agentStates) {
        const jsonState = agentStates.find((state) => state.agentName === name)?.state;
        if (jsonState) {
          state = JSON.parse(jsonState);
        }
      }

      const response = await fetch(`${url}/agents/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name,
          threadId,
          nodeName,
          messages,
          state,
          properties: graphqlContext.properties,
          actions: actionInputsWithoutAgents.map((action) => ({
            name: action.name,
            description: action.description,
            parameters: JSON.parse(action.jsonSchema),
          })),
        }),
      });

      if (!response.ok) {
        logger.error(
          { url, status: response.status, body: await response.text() },
          "Failed to execute remote agent",
        );
        throw new Error("Failed to execute remote agent");
      }

      const eventSource = new RemoteLangGraphEventSource();
      streamResponse(response, eventSource.eventStream$);
      return eventSource.processLangGraphEvents();
    },
  }));

  return [...actions, ...agents];
}

async function streamResponse(response: Response, eventStream$: ReplaySubject<LangGraphEvent>) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = [];

  function flushBuffer() {
    const currentBuffer = buffer.join("");
    if (currentBuffer.trim().length === 0) {
      return;
    }
    const parts = currentBuffer.split("\n");
    if (parts.length === 0) {
      return;
    }

    const lastPartIsComplete = currentBuffer.endsWith("\n");

    // truncate buffer
    buffer = [];

    if (!lastPartIsComplete) {
      // put back the last part
      buffer.push(parts.pop());
    }

    parts
      .map((part) => part.trim())
      .filter((part) => part != "")
      .forEach((part) => {
        eventStream$.next(JSON.parse(part));
      });
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (!done) {
        buffer.push(decoder.decode(value, { stream: true }));
      }

      flushBuffer();

      if (done) {
        break;
      }
    }
  } catch (error) {
    console.error("Error in stream", error);
    eventStream$.error(error);
    return;
  }
  eventStream$.complete();
}

export async function setupRemoteActions({
  remoteActionDefinitions,
  graphqlContext,
  messages,
  agentStates,
  frontendUrl,
}: {
  remoteActionDefinitions: RemoteActionDefinition[];
  graphqlContext: GraphQLContext;
  messages: Message[];
  agentStates?: AgentStateInput[];
  frontendUrl?: string;
}): Promise<Action[]> {
  const logger = graphqlContext.logger.child({ component: "remote-actions.fetchRemoteActions" });
  logger.debug({ remoteActionDefinitions }, "Fetching remote actions");

  // Remove duplicates of remoteActionDefinitions.url
  const filtered = remoteActionDefinitions.filter((value, index, self) => {
    if (value.type === RemoteActionType.LangGraphCloud) {
      return value;
    }
    return index === self.findIndex((t: RemoteAction) => t.url === value.url);
  });

  const result = await Promise.all(
    filtered.map(async (actionDefinition) => {
      // Check for properties that can distinguish LG cloud from other actions
      if (actionDefinition.type === RemoteActionType.LangGraphCloud) {
        // TODO: Construct LG Cloud remote action
        return;
      }

      const json = await fetchRemoteInfo({
        url: actionDefinition.url,
        onBeforeRequest: actionDefinition.onBeforeRequest,
        graphqlContext,
        logger: logger.child({ component: "remote-actions.fetchActionsFromUrl", actionDefinition }),
        frontendUrl,
      });

      return constructRemoteActions({
        json,
        messages,
        url: actionDefinition.url,
        onBeforeRequest: actionDefinition.onBeforeRequest,
        graphqlContext,
        logger: logger.child({ component: "remote-actions.constructActions", actionDefinition }),
        agentStates,
      });
    }),
  );

  return result.flat();
}
