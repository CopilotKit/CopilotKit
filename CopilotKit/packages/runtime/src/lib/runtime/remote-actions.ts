import { Action, CopilotKitErrorCode } from "@copilotkit/shared";
import { GraphQLContext } from "../integrations/shared";
import { Logger } from "pino";
import { Message } from "../../graphql/types/converted";
import { RuntimeEvent } from "../../service-adapters/events";
import { Observable } from "rxjs";
import { ActionInput } from "../../graphql/inputs/action.input";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";
import {
  constructLGCRemoteAction,
  constructRemoteActions,
  createHeaders,
} from "./remote-action-constructors";
import {
  CopilotKitLowLevelError,
  ResolvedCopilotKitError,
  CopilotKitError,
} from "@copilotkit/shared";
import { MetaEventInput } from "../../graphql/inputs/meta-event.input";
import { AbstractAgent } from "@ag-ui/client";
import { constructAGUIRemoteAction } from "./agui-action";

export type EndpointDefinition = CopilotKitEndpoint | LangGraphPlatformEndpoint;

export enum EndpointType {
  CopilotKit = "copilotKit",
  LangGraphPlatform = "langgraph-platform",
}

export interface BaseEndpointDefinition<TActionType extends EndpointType> {
  type?: TActionType;
}

export interface CopilotKitEndpoint extends BaseEndpointDefinition<EndpointType.CopilotKit> {
  url: string;
  onBeforeRequest?: ({ ctx }: { ctx: GraphQLContext }) => {
    headers?: Record<string, string> | undefined;
  };
}

export interface LangGraphPlatformAgent {
  name: string;
  description: string;
  assistantId?: string;
}

export interface LangGraphPlatformEndpoint
  extends BaseEndpointDefinition<EndpointType.LangGraphPlatform> {
  deploymentUrl: string;
  langsmithApiKey?: string | null;
  agents: LangGraphPlatformAgent[];
}

export type RemoteActionInfoResponse = {
  actions: any[];
  agents: any[];
};

export type RemoteAgentHandlerParams = {
  name: string;
  actionInputsWithoutAgents: ActionInput[];
  threadId?: string;
  nodeName?: string;
  additionalMessages?: Message[];
  metaEvents?: MetaEventInput[];
};

export type RemoteAgentAction = Action<any> & {
  remoteAgentHandler: (params: RemoteAgentHandlerParams) => Promise<Observable<RuntimeEvent>>;
};

export function isRemoteAgentAction(action: Action<any>): action is RemoteAgentAction {
  if (!action) {
    return false;
  }
  return typeof (action as RemoteAgentAction).remoteAgentHandler === "function";
}

async function fetchRemoteInfo({
  url,
  onBeforeRequest,
  graphqlContext,
  logger,
  frontendUrl,
}: {
  url: string;
  onBeforeRequest?: CopilotKitEndpoint["onBeforeRequest"];
  graphqlContext: GraphQLContext;
  logger: Logger;
  frontendUrl?: string;
}): Promise<RemoteActionInfoResponse> {
  logger.debug({ url }, "Fetching actions from url");
  const headers = createHeaders(onBeforeRequest, graphqlContext);

  const fetchUrl = `${url}/info`;
  try {
    const response = await fetch(fetchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ properties: graphqlContext.properties, frontendUrl }),
    });

    if (!response.ok) {
      logger.error(
        { url, status: response.status, body: await response.text() },
        "Failed to fetch actions from url",
      );
      throw new ResolvedCopilotKitError({
        status: response.status,
        url: fetchUrl,
        isRemoteEndpoint: true,
      });
    }

    const json = await response.json();
    logger.debug({ json }, "Fetched actions from url");
    return json;
  } catch (error) {
    if (error instanceof CopilotKitError) {
      throw error;
    }
    throw new CopilotKitLowLevelError({ error, url: fetchUrl });
  }
}

export async function setupRemoteActions({
  remoteEndpointDefinitions,
  graphqlContext,
  messages,
  agentStates,
  frontendUrl,
  agents,
  metaEvents,
  nodeName,
}: {
  remoteEndpointDefinitions: EndpointDefinition[];
  graphqlContext: GraphQLContext;
  messages: Message[];
  agentStates?: AgentStateInput[];
  frontendUrl?: string;
  agents: Record<string, AbstractAgent>;
  metaEvents?: MetaEventInput[];
  nodeName?: string;
}): Promise<Action[]> {
  const logger = graphqlContext.logger.child({ component: "remote-actions.fetchRemoteActions" });
  logger.debug({ remoteEndpointDefinitions }, "Fetching from remote endpoints");

  const threadMetadata = (graphqlContext.properties?.threadMetadata as Record<string, any>) || {};

  // Remove duplicates of remoteEndpointDefinitions.url
  const filtered = remoteEndpointDefinitions.filter((value, index, self) => {
    if (value.type === EndpointType.LangGraphPlatform) {
      return value;
    }
    return index === self.findIndex((t: CopilotKitEndpoint) => t.url === value.url);
  });

  const result = await Promise.all(
    filtered.map(async (endpoint) => {
      // Check for properties that can distinguish LG platform from other actions
      if (endpoint.type === EndpointType.LangGraphPlatform) {
        return constructLGCRemoteAction({
          endpoint,
          messages,
          graphqlContext,
          logger: logger.child({
            component: "remote-actions.constructLGCRemoteAction",
            endpoint,
          }),
          agentStates,
        });
      }

      const json = await fetchRemoteInfo({
        url: endpoint.url,
        onBeforeRequest: endpoint.onBeforeRequest,
        graphqlContext,
        logger: logger.child({ component: "remote-actions.fetchActionsFromUrl", endpoint }),
        frontendUrl,
      });

      return constructRemoteActions({
        json,
        messages,
        url: endpoint.url,
        onBeforeRequest: endpoint.onBeforeRequest,
        graphqlContext,
        logger: logger.child({ component: "remote-actions.constructActions", endpoint }),
        agentStates,
      });
    }),
  );

  for (const [key, agent] of Object.entries(agents)) {
    if (agent.agentId !== undefined && agent.agentId !== key) {
      throw new CopilotKitError({
        message: `Agent ${key} has agentId ${agent.agentId} which does not match the key ${key}`,
        code: CopilotKitErrorCode.UNKNOWN,
      });
    } else if (agent.agentId === undefined) {
      agent.agentId = key;
    }

    result.push(
      constructAGUIRemoteAction({
        logger,
        messages,
        agentStates,
        agent: agent,
        metaEvents,
        threadMetadata,
        nodeName,
        graphqlContext,
      }),
    );
  }

  return result.flat();
}
