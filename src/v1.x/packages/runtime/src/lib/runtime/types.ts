import { GraphQLContext } from "../integrations";
import { ActionInput } from "../../graphql/inputs/action.input";
import { Message } from "../../graphql/types/converted";
import { MetaEventInput } from "../../graphql/inputs/meta-event.input";

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

export type EndpointDefinition = CopilotKitEndpoint | LangGraphPlatformEndpoint;

export enum EndpointType {
  CopilotKit = "copilotKit",
  LangGraphPlatform = "langgraph-platform",
}
