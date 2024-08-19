import { Action } from "@copilotkit/shared";
import { GraphQLContext } from "../integrations/shared";
import { Logger } from "pino";
import telemetry from "../../lib/telemetry-client";
import { Message } from "../../graphql/types/converted";
import { RuntimeEvent, RuntimeEventSubject } from "../../service-adapters/events";
import { RemoteLangGraphEventSource } from "../../agents/langgraph/event-source";
import { Observable } from "rxjs";
import { ActionInput } from "../../graphql/inputs/action.input";

export type RemoteActionDefinition = {
  url: string;
  onBeforeRequest?: ({ ctx }: { ctx: GraphQLContext }) => {
    headers?: Record<string, string> | undefined;
  };
};

export type LangGraphAgentHandlerParams = {
  name: string;
  state: any;
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
  onBeforeRequest: RemoteActionDefinition["onBeforeRequest"],
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
}: {
  url: string;
  onBeforeRequest?: RemoteActionDefinition["onBeforeRequest"];
  graphqlContext: GraphQLContext;
  logger: Logger;
}): Promise<any[]> {
  logger.debug({ url }, "Fetching actions from url");
  const headers = createHeaders(onBeforeRequest, graphqlContext);

  const response = await fetch(`${url}/info`, {
    method: "POST",
    headers,
    body: JSON.stringify({ properties: graphqlContext.properties }),
  });

  if (!response.ok) {
    logger.error(
      { url, status: response.status, body: await response.text() },
      "Failed to fetch actions from url",
    );
    return [];
  }

  const json = await response.json();
  logger.debug({ json }, "Fetched actions from url");
  return json;
}

function constructRemoteActions({
  json,
  url,
  onBeforeRequest,
  graphqlContext,
  logger,
  messages,
}: {
  json: any[];
  url: string;
  onBeforeRequest?: RemoteActionDefinition["onBeforeRequest"];
  graphqlContext: GraphQLContext;
  logger: Logger;
  messages: Message[];
}): Action<any>[] {
  const actions = json["actions"].map((action) => ({
    name: action.name,
    description: action.description,
    parameters: action.parameters,
    handler: async (args: any) => {
      logger.debug({ actionName: action.name, args }, "Executing remote action");

      const headers = createHeaders(onBeforeRequest, graphqlContext);
      telemetry.capture("oss.runtime.remote_action_executed", {});

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
    },
  }));

  const agents = json["agents"].map((agent) => ({
    name: agent.name,
    description: agent.description,
    parameters: agent.parameters,
    handler: async (_args: any) => {},

    langGraphAgentHandler: async ({
      name,
      state,
      actionInputsWithoutAgents,
      threadId,
      nodeName,
    }: LangGraphAgentHandlerParams): Promise<Observable<RuntimeEvent>> => {
      logger.debug({ actionName: agent.name, state }, "Executing remote agent");

      const headers = createHeaders(onBeforeRequest, graphqlContext);
      telemetry.capture("oss.runtime.remote_action_executed", {});

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
      eventSource.streamResponse(response);
      return eventSource.processLangGraphEvents();
    },
  }));

  return [...actions, ...agents];
}

export async function setupRemoteActions({
  remoteActionDefinitions,
  graphqlContext,
  messages,
}: {
  remoteActionDefinitions: RemoteActionDefinition[];
  graphqlContext: GraphQLContext;
  messages: Message[];
}): Promise<Action[]> {
  const logger = graphqlContext.logger.child({ component: "remote-actions.fetchRemoteActions" });
  logger.debug({ remoteActionDefinitions }, "Fetching remote actions");

  // Remove duplicates of remoteActionDefinitions.url
  const filtered = remoteActionDefinitions.filter(
    (value, index, self) => index === self.findIndex((t) => t.url === value.url),
  );

  const result = await Promise.all(
    filtered.map(async (actionDefinition) => {
      const json = await fetchRemoteInfo({
        url: actionDefinition.url,
        onBeforeRequest: actionDefinition.onBeforeRequest,
        graphqlContext,
        logger: logger.child({ component: "remote-actions.fetchActionsFromUrl", actionDefinition }),
      });
      return constructRemoteActions({
        json,
        messages,
        url: actionDefinition.url,
        onBeforeRequest: actionDefinition.onBeforeRequest,
        graphqlContext,
        logger: logger.child({ component: "remote-actions.constructActions", actionDefinition }),
      });
    }),
  );

  return result.flat();
}
