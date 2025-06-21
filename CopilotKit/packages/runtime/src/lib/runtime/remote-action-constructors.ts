import { createHash } from "node:crypto";
import {
  CopilotKitEndpoint,
  RemoteAgentHandlerParams,
  RemoteActionInfoResponse,
  LangGraphPlatformEndpoint,
} from "./remote-actions";
import { GraphQLContext } from "../integrations";
import { Logger } from "pino";
import { Message } from "../../graphql/types/converted";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";
import { Observable } from "rxjs";
import { RuntimeEvent, RuntimeEventSubject } from "../../service-adapters/events";
import telemetry from "../telemetry-client";
import { RemoteLangGraphEventSource } from "../../agents/langgraph/event-source";
import { Action } from "@copilotkit/shared";
import { execute } from "./remote-lg-action";
import { CopilotKitError, CopilotKitLowLevelError } from "@copilotkit/shared";
import { writeJsonLineResponseToEventStream } from "../streaming";
import { CopilotKitApiDiscoveryError, ResolvedCopilotKitError } from "@copilotkit/shared";
import { parseJson, tryMap } from "@copilotkit/shared";
import { ActionInput } from "../../graphql/inputs/action.input";
import { fetchWithRetry } from "./retry-utils";

// Import the utility function from remote-lg-action
import { isUserConfigurationError } from "./remote-lg-action";

export function constructLGCRemoteAction({
  endpoint,
  graphqlContext,
  logger,
  messages,
  agentStates,
}: {
  endpoint: LangGraphPlatformEndpoint;
  graphqlContext: GraphQLContext;
  logger: Logger;
  messages: Message[];
  agentStates?: AgentStateInput[];
}) {
  const agents = endpoint.agents.map((agent) => ({
    name: agent.name,
    description: agent.description,
    parameters: [],
    handler: async (_args: any) => {},
    remoteAgentHandler: async ({
      name,
      actionInputsWithoutAgents,
      threadId,
      nodeName,
      additionalMessages = [],
      metaEvents,
    }: RemoteAgentHandlerParams): Promise<Observable<RuntimeEvent>> => {
      logger.debug({ actionName: agent.name }, "Executing LangGraph Platform agent");

      telemetry.capture("oss.runtime.remote_action_executed", {
        agentExecution: true,
        type: "langgraph-platform",
        agentsAmount: endpoint.agents.length,
        hashedLgcKey: endpoint.langsmithApiKey
          ? createHash("sha256").update(endpoint.langsmithApiKey).digest("hex")
          : null,
      });

      let state = {};
      let config = {};
      if (agentStates) {
        const jsonState = agentStates.find((state) => state.agentName === name);
        if (jsonState) {
          state = parseJson(jsonState.state, {});
          config = parseJson(jsonState.config, {});
        }
      }

      try {
        const response = await execute({
          logger: logger.child({ component: "remote-actions.remote-lg-action.streamEvents" }),
          deploymentUrl: endpoint.deploymentUrl,
          langsmithApiKey: endpoint.langsmithApiKey,
          agent,
          threadId,
          nodeName,
          messages: [...messages, ...additionalMessages],
          state,
          config,
          properties: graphqlContext.properties,
          actions: tryMap(actionInputsWithoutAgents, (action: ActionInput) => ({
            name: action.name,
            description: action.description,
            parameters: JSON.parse(action.jsonSchema),
          })),
          metaEvents,
        });

        const eventSource = new RemoteLangGraphEventSource();
        writeJsonLineResponseToEventStream(response, eventSource.eventStream$);
        return eventSource.processLangGraphEvents();
      } catch (error) {
        // Preserve structured CopilotKit errors with semantic information
        if (error instanceof CopilotKitError || error instanceof CopilotKitLowLevelError) {
          // Distinguish between user errors and system errors for logging
          if (isUserConfigurationError(error)) {
            logger.debug(
              { url: endpoint.deploymentUrl, error: error.message, code: error.code },
              "User configuration error in LangGraph Platform agent",
            );
          } else {
            logger.error(
              { url: endpoint.deploymentUrl, error: error.message, type: error.constructor.name },
              "LangGraph Platform agent error",
            );
          }
          throw error; // Re-throw the structured error to preserve semantic information
        }

        // For other errors, log and wrap them
        logger.error(
          { url: endpoint.deploymentUrl, status: 500, body: error.message },
          "Failed to execute LangGraph Platform agent",
        );
        throw new CopilotKitLowLevelError({
          error: error instanceof Error ? error : new Error(String(error)),
          url: endpoint.deploymentUrl,
          message: "Failed to execute LangGraph Platform agent",
        });
      }
    },
  }));

  return [...agents];
}

export enum RemoteAgentType {
  LangGraph = "langgraph",
  CrewAI = "crewai",
}

export function constructRemoteActions({
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
  onBeforeRequest?: CopilotKitEndpoint["onBeforeRequest"];
  graphqlContext: GraphQLContext;
  logger: Logger;
  messages: Message[];
  agentStates?: AgentStateInput[];
}): Action<any>[] {
  const totalAgents = Array.isArray(json["agents"]) ? json["agents"].length : 0;

  const actions = json["actions"].map((action) => ({
    name: action.name,
    description: action.description,
    parameters: action.parameters,
    handler: async (args: any) => {
      logger.debug({ actionName: action.name, args }, "Executing remote action");

      const headers = createHeaders(onBeforeRequest, graphqlContext);
      telemetry.capture("oss.runtime.remote_action_executed", {
        agentExecution: false,
        type: "self-hosted",
        agentsAmount: totalAgents,
      });

      const fetchUrl = `${url}/actions/execute`;
      try {
        const response = await fetchWithRetry(
          fetchUrl,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: action.name,
              arguments: args,
              properties: graphqlContext.properties,
            }),
          },
          logger,
        );

        if (!response.ok) {
          logger.error(
            { url, status: response.status, body: await response.text() },
            "Failed to execute remote action",
          );
          if (response.status === 404) {
            throw new CopilotKitApiDiscoveryError({ url: fetchUrl });
          }
          throw new ResolvedCopilotKitError({
            status: response.status,
            url: fetchUrl,
            isRemoteEndpoint: true,
          });
        }

        const requestResult = await response.json();

        const result = requestResult["result"];
        logger.debug({ actionName: action.name, result }, "Executed remote action");
        return result;
      } catch (error) {
        if (error instanceof CopilotKitError || error instanceof CopilotKitLowLevelError) {
          throw error;
        }
        throw new CopilotKitLowLevelError({ error, url: fetchUrl });
      }
    },
  }));

  const agents = totalAgents
    ? json["agents"].map((agent) => ({
        name: agent.name,
        description: agent.description,
        parameters: [],
        handler: async (_args: any) => {},

        remoteAgentHandler: async ({
          name,
          actionInputsWithoutAgents,
          threadId,
          nodeName,
          additionalMessages = [],
          metaEvents,
        }: RemoteAgentHandlerParams): Promise<Observable<RuntimeEvent>> => {
          logger.debug({ actionName: agent.name }, "Executing remote agent");

          const headers = createHeaders(onBeforeRequest, graphqlContext);
          telemetry.capture("oss.runtime.remote_action_executed", {
            agentExecution: true,
            type: "self-hosted",
            agentsAmount: json["agents"].length,
          });

          let state = {};
          let config = {};
          if (agentStates) {
            const jsonState = agentStates.find((state) => state.agentName === name);
            if (jsonState) {
              state = parseJson(jsonState.state, {});
              config = parseJson(jsonState.config, {});
            }
          }

          const fetchUrl = `${url}/agents/execute`;
          try {
            const response = await fetchWithRetry(
              fetchUrl,
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  name,
                  threadId,
                  nodeName,
                  messages: [...messages, ...additionalMessages],
                  state,
                  config,
                  properties: graphqlContext.properties,
                  actions: tryMap(actionInputsWithoutAgents, (action: ActionInput) => ({
                    name: action.name,
                    description: action.description,
                    parameters: JSON.parse(action.jsonSchema),
                  })),
                  metaEvents,
                }),
              },
              logger,
            );

            if (!response.ok) {
              logger.error(
                { url, status: response.status, body: await response.text() },
                "Failed to execute remote agent",
              );
              if (response.status === 404) {
                throw new CopilotKitApiDiscoveryError({ url: fetchUrl });
              }
              throw new ResolvedCopilotKitError({
                status: response.status,
                url: fetchUrl,
                isRemoteEndpoint: true,
              });
            }

            if (agent.type === RemoteAgentType.LangGraph) {
              const eventSource = new RemoteLangGraphEventSource();
              writeJsonLineResponseToEventStream(response.body!, eventSource.eventStream$);
              return eventSource.processLangGraphEvents();
            } else if (agent.type === RemoteAgentType.CrewAI) {
              const eventStream$ = new RuntimeEventSubject();
              writeJsonLineResponseToEventStream(response.body!, eventStream$);
              return eventStream$;
            } else {
              throw new Error("Unsupported agent type");
            }
          } catch (error) {
            if (error instanceof CopilotKitError || error instanceof CopilotKitLowLevelError) {
              throw error;
            }
            throw new CopilotKitLowLevelError({ error, url: fetchUrl });
          }
        },
      }))
    : [];

  return [...actions, ...agents];
}

export function createHeaders(
  onBeforeRequest: CopilotKitEndpoint["onBeforeRequest"],
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
