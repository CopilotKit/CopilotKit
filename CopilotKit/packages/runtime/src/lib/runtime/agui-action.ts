import { Logger } from "pino";
import { catchError, mergeMap, Observable, of, throwError } from "rxjs";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";
import { Message } from "../../graphql/types/converted";
import { RuntimeErrorEvent, RuntimeEvent, RuntimeEventTypes } from "../../service-adapters/events";
import telemetry from "../telemetry-client";
import { RemoteAgentHandlerParams } from "./remote-actions";

import {
  AssistantMessage as AGUIAssistantMessage,
  Message as AGUIMessage,
  ToolCall,
} from "@ag-ui/client";

import { AbstractAgent } from "@ag-ui/client";
import { Action, CopilotKitError, CopilotKitErrorCode, parseJson } from "@copilotkit/shared";
import { MetaEventInput } from "../../graphql/inputs/meta-event.input";
import { GraphQLContext } from "../integrations/shared";
import { CopilotContextInput } from "../../graphql/inputs/copilot-context.input";

export type RemoteAgentAction = Action<[]> & {
  remoteAgentHandler: (params: RemoteAgentHandlerParams) => Promise<Observable<RuntimeEvent>>;
};

export function constructAGUIRemoteAction({
  logger,
  messages,
  agentStates,
  agent,
  metaEvents,
  threadMetadata,
  nodeName,
  context,
  graphqlContext,
}: {
  logger: Logger;
  messages: Message[];
  agentStates?: AgentStateInput[];
  agent: AbstractAgent;
  metaEvents?: MetaEventInput[];
  threadMetadata?: Record<string, any>;
  nodeName?: string;
  context?: CopilotContextInput[];
  graphqlContext: GraphQLContext;
}): RemoteAgentAction[] {
  const action: RemoteAgentAction = {
    name: agent.agentId,
    description: agent.description,
    parameters: [],
    handler: async () => {},
    remoteAgentHandler: async ({
      actionInputsWithoutAgents,
      threadId,
    }: RemoteAgentHandlerParams): Promise<Observable<RuntimeEvent>> => {
      graphqlContext.request.signal.addEventListener(
        "abort",
        () => {
          agent.abortRun();
        },
        { once: true }, // optional: fire only once
      );
      logger.debug({ actionName: agent.agentId }, "Executing remote agent");

      const agentWireMessages = convertMessagesToAGUIMessage(messages);
      agent.messages = agentWireMessages;
      agent.threadId = threadId;

      telemetry.capture("oss.runtime.remote_action_executed", {
        agentExecution: true,
        type: "self-hosted",
        agentsAmount: 1,
      });

      let state = {};
      let config: Record<string, unknown> = {};
      if (agentStates) {
        const jsonState = agentStates.find((state) => state.agentName === agent.agentId);
        if (jsonState) {
          state = parseJson(jsonState.state, {});
          config = parseJson(jsonState.config, {});
        }
      }
      agent.state = state;

      const tools = actionInputsWithoutAgents.map((input) => {
        return {
          name: input.name,
          description: input.description,
          parameters: JSON.parse(input.jsonSchema),
        };
      });

      const { streamSubgraphs, ...restConfig } = config;

      const forwardedProps = {
        config: restConfig,
        ...(metaEvents?.length ? { command: { resume: metaEvents[0]?.response } } : {}),
        ...(threadMetadata ? { threadMetadata } : {}),
        ...(nodeName ? { nodeName } : {}),
        ...(streamSubgraphs ? { streamSubgraphs } : {}),
        // Forward properties from the graphql context to the agent, e.g Authorization token
        ...graphqlContext.properties,
      };

      return (
        agent.legacy_to_be_removed_runAgentBridged({
          tools,
          forwardedProps,
          context,
        }) as Observable<RuntimeEvent>
      ).pipe(
        mergeMap((event) => {
          if (event.type === RuntimeEventTypes.RunError) {
            const { message } = event as RuntimeErrorEvent;
            return throwError(
              () => new CopilotKitError({ message, code: CopilotKitErrorCode.UNKNOWN }),
            );
          }
          // pass through non-error events
          return of(event);
        }),
        catchError((err) => {
          throw new CopilotKitError({
            message: err.message,
            code: CopilotKitErrorCode.UNKNOWN,
          });
        }),
      );
    },
  };
  return [action];
}

export function convertMessagesToAGUIMessage(messages: Message[]): AGUIMessage[] {
  const result: AGUIMessage[] = [];

  for (const message of messages) {
    if (message.isTextMessage()) {
      result.push({
        id: message.id,
        role: message.role as any,
        content: message.content,
      });
    } else if (message.isActionExecutionMessage()) {
      const toolCall: ToolCall = {
        id: message.id,
        type: "function",
        function: {
          name: message.name,
          arguments: JSON.stringify(message.arguments),
        },
      };

      if (message.parentMessageId && result.some((m) => m.id === message.parentMessageId)) {
        const parentMessage: AGUIAssistantMessage | undefined = result.find(
          (m) => m.id === message.parentMessageId,
        ) as AGUIAssistantMessage;
        if (parentMessage.toolCalls === undefined) {
          parentMessage.toolCalls = [];
        }
        parentMessage.toolCalls.push(toolCall);
      } else {
        result.push({
          id: message.parentMessageId ?? message.id,
          role: "assistant",
          toolCalls: [toolCall],
        });
      }
    } else if (message.isResultMessage()) {
      result.push({
        id: message.id,
        role: "tool",
        content: message.result,
        toolCallId: message.actionExecutionId,
      });
    }
  }

  return result;
}
