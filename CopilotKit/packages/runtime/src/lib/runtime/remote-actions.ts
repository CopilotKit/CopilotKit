import { Action } from "@copilotkit/shared";
import { GraphQLContext } from "../integrations/shared";
import { Logger } from "pino";
import telemetry from "../../lib/telemetry-client";

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
      const result = requestResult["result"];
      logger.debug({ actionName: action.name, result }, "Executed remote action");
      return result;
    },
  }));
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
