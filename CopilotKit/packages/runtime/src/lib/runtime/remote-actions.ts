import { Action } from "@copilotkit/shared";
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

export type RemoteEndpointDefinition = RemoteAction | RemoteLangGraphCloudAction;

export enum RemoteEndpointType {
  Remote = "remote",
  LangGraphCloud = "langgraph-cloud",
}

export interface BaseRemoteEndpointDefinition<TActionType extends RemoteEndpointType> {
  type?: TActionType;
}

export interface RemoteAction extends BaseRemoteEndpointDefinition<RemoteEndpointType.Remote> {
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
  extends BaseRemoteEndpointDefinition<RemoteEndpointType.LangGraphCloud> {
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

export async function setupRemoteActions({
  remoteEndpointDefinitions,
  graphqlContext,
  messages,
  agentStates,
  frontendUrl,
}: {
  remoteEndpointDefinitions: RemoteEndpointDefinition[];
  graphqlContext: GraphQLContext;
  messages: Message[];
  agentStates?: AgentStateInput[];
  frontendUrl?: string;
}): Promise<Action[]> {
  const logger = graphqlContext.logger.child({ component: "remote-actions.fetchRemoteActions" });
  logger.debug({ remoteEndpointDefinitions }, "Fetching from remote endpoints");

  // Remove duplicates of remoteEndpointDefinitions.url
  const filtered = remoteEndpointDefinitions.filter((value, index, self) => {
    if (value.type === RemoteEndpointType.LangGraphCloud) {
      return value;
    }
    return index === self.findIndex((t: RemoteAction) => t.url === value.url);
  });

  const result = await Promise.all(
    filtered.map(async (actionDefinition) => {
      // Check for properties that can distinguish LG cloud from other actions
      if (actionDefinition.type === RemoteEndpointType.LangGraphCloud) {
        return constructLGCRemoteAction({
          action: actionDefinition,
          messages,
          graphqlContext,
          logger: logger.child({
            component: "remote-actions.constructLGCRemoteAction",
            actionDefinition,
          }),
          agentStates,
        });
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
