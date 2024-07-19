import { Action } from "@copilotkit/shared";
import { GraphQLContext } from "../integrations/shared";
import { Logger } from "pino";
import telemetry from "../../lib/telemetry-client";

export type AgentResult = {
  threadId: string;
  state: string;
  name: string;
  running: boolean;
  __agentMessage: true;
};

export function isAgentResult(
  obj: any,
  checkAgentMessageFlag: boolean = false,
): obj is AgentResult {
  if (checkAgentMessageFlag) {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "__agentMessage" in obj &&
      obj.__agentMessage === true
    );
  } else {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "threadId" in obj &&
      "state" in obj &&
      "running" in obj &&
      "name" in obj
    );
  }
}

export type RemoteActionDefinition = {
  url: string;
  onBeforeRequest?: ({ ctx }: { ctx: GraphQLContext }) => {
    headers?: Record<string, string> | undefined;
  };
};

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

async function fetchActionsFromUrl({
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

  const response = await fetch(`${url}/actions/list`, {
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

function constructActions({
  json,
  url,
  onBeforeRequest,
  graphqlContext,
  logger,
}: {
  json: any[];
  url: string;
  onBeforeRequest?: RemoteActionDefinition["onBeforeRequest"];
  graphqlContext: GraphQLContext;
  logger: Logger;
}): Action<any>[] {
  return json["actions"].map((action) => ({
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
          parameters: args,
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

      if (isAgentResult(requestResult)) {
        logger.debug({ actionName: action.name, result: requestResult }, "Started agent session");
        // TODO: instead of __agentMessage, we should use __copilotKit: {type: "agentMessage"}
        return { ...requestResult, __agentMessage: true };
      } else {
        const result = requestResult["result"];
        logger.debug({ actionName: action.name, result }, "Executed remote action");
        return result;
      }
    },
  }));
}

export async function executeAgent({
  agentName,
  threadId,
  state,
  url,
  onBeforeRequest,
  graphqlContext,
  logger,
}: {
  agentName: string;
  threadId: string;
  state: string;
  url: string;
  onBeforeRequest?: RemoteActionDefinition["onBeforeRequest"];
  graphqlContext: GraphQLContext;
  logger: Logger;
}): Promise<AgentResult> {
  logger.debug({ agentName, threadId, state }, "Executing remote action");

  const headers = createHeaders(onBeforeRequest, graphqlContext);
  telemetry.capture("oss.runtime.remote_action_executed", {});

  const response = await fetch(`${url}/actions/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      threadId,
      state,
      name: agentName,
    }),
  });

  if (!response.ok) {
    logger.error(
      { url, status: response.status, body: await response.text() },
      "Failed to execute remote agent",
    );
    throw new Error("Failed to execute remote agent");
  }

  const requestResult = await response.json();
  logger.debug({ agentName, threadId, state }, "Executed remote agent");
  return { ...requestResult, __agentMessage: true };
}

export async function setupRemoteActions({
  remoteActionDefinitions,
  graphqlContext,
}: {
  remoteActionDefinitions: RemoteActionDefinition[];
  graphqlContext: GraphQLContext;
}): Promise<Action[]> {
  const logger = graphqlContext.logger.child({ component: "remote-actions.fetchRemoteActions" });
  logger.debug({ remoteActionDefinitions }, "Fetching remote actions");

  // Remove duplicates of remoteActionDefinitions.url
  const filtered = remoteActionDefinitions.filter(
    (value, index, self) => index === self.findIndex((t) => t.url === value.url),
  );

  const result = await Promise.all(
    filtered.map(async (actionDefinition) => {
      const json = await fetchActionsFromUrl({
        url: actionDefinition.url,
        onBeforeRequest: actionDefinition.onBeforeRequest,
        graphqlContext,
        logger: logger.child({ component: "remote-actions.fetchActionsFromUrl", actionDefinition }),
      });
      return constructActions({
        json,
        url: actionDefinition.url,
        onBeforeRequest: actionDefinition.onBeforeRequest,
        graphqlContext,
        logger: logger.child({ component: "remote-actions.constructActions", actionDefinition }),
      });
    }),
  );

  return result.flat();
}

export async function fetchRemoteActionLocations({
  remoteActionDefinitions,
  graphqlContext,
}: {
  remoteActionDefinitions: RemoteActionDefinition[];
  graphqlContext: GraphQLContext;
}): Promise<Map<string, string>> {
  const logger = graphqlContext.logger.child({
    component: "remote-actions.fetchRemoteActionLocations",
  });
  logger.debug({ remoteActionDefinitions }, "Fetching remote action locations");

  // Remove duplicates of remoteActionDefinitions.url
  const filtered = remoteActionDefinitions.filter(
    (value, index, self) => index === self.findIndex((t) => t.url === value.url),
  );

  const result = new Map<string, string>();

  await Promise.all(
    filtered.map(async (actionDefinition) => {
      const json = await fetchActionsFromUrl({
        url: actionDefinition.url,
        onBeforeRequest: actionDefinition.onBeforeRequest,
        graphqlContext,
        logger: logger.child({ component: "remote-actions.fetchActionsFromUrl", actionDefinition }),
      });

      json["actions"].forEach((action) => {
        result.set(action.name, actionDefinition.url);
      });
    }),
  );

  return result;
}
