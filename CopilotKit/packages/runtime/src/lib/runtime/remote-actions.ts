import { Action } from "@copilotkit/shared";
import { GraphQLContext } from "../integrations/shared";

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
}: {
  url: string;
  onBeforeRequest?: RemoteActionDefinition["onBeforeRequest"];
  graphqlContext: GraphQLContext;
}): Promise<any[]> {
  const headers = createHeaders(onBeforeRequest, graphqlContext);

  const response = await fetch(`${url}/actions/list`, {
    method: "POST",
    headers,
    body: JSON.stringify({ properties: graphqlContext.properties }),
  });
  return await response.json();
}

function constructActions({
  json,
  url,
  onBeforeRequest,
  graphqlContext,
}: {
  json: any[];
  url: string;
  onBeforeRequest?: RemoteActionDefinition["onBeforeRequest"];
  graphqlContext: GraphQLContext;
}): Action<any>[] {
  return json.map((action) => ({
    name: action.name,
    description: action.description,
    parameters: action.parameters,
    handler: async (args: any) => {
      const headers = createHeaders(onBeforeRequest, graphqlContext);

      const response = await fetch(`${url}/actions/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: action.name,
          parameters: args,
          properties: graphqlContext.properties,
        }),
      });
      return await response.text();
    },
  }));
}

export async function fetchRemoteActions({
  remoteActionDefinitions,
  graphqlContext,
}: {
  remoteActionDefinitions: RemoteActionDefinition[];
  graphqlContext: GraphQLContext;
}): Promise<Action[]> {
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
      });
      return constructActions({
        json,
        url: actionDefinition.url,
        onBeforeRequest: actionDefinition.onBeforeRequest,
        graphqlContext,
      });
    }),
  );

  return result.flat();
}
