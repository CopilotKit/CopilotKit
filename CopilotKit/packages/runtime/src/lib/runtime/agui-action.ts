import { Logger } from "pino";
import { Observable } from "rxjs";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";
import { Message } from "../../graphql/types/converted";
import { RuntimeEvent } from "../../service-adapters/events";
import telemetry from "../telemetry-client";
import { RemoteAgentHandlerParams } from "./remote-actions";

import {
  AssistantMessage as AGUIAssistantMessage,
  Message as AGUIMessage,
  ToolCall,
} from "@ag-ui/client";

import { AbstractAgent } from "@ag-ui/client";
import { parseJson } from "@copilotkit/shared";
import { MetaEventInput } from "../../graphql/inputs/meta-event.input";

export function constructAGUIRemoteAction({
  logger,
  messages,
  agentStates,
  agent,
  metaEvents,
}: {
  logger: Logger;
  messages: Message[];
  agentStates?: AgentStateInput[];
  agent: AbstractAgent;
  metaEvents?: MetaEventInput[];
}) {
  const action = {
    name: agent.agentId,
    description: agent.description,
    parameters: [],
    handler: async (_args: any) => {},
    remoteAgentHandler: async ({
      actionInputsWithoutAgents,
      threadId,
    }: RemoteAgentHandlerParams): Promise<Observable<RuntimeEvent>> => {
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
      if (agentStates) {
        const jsonState = agentStates.find((state) => state.agentName === agent.agentId);
        if (jsonState) {
          state = parseJson(jsonState.state, {});
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

      const forwardedProps = metaEvents.length
        ? { command: { resume: metaEvents[0]?.response } }
        : undefined;

      return agent.legacy_to_be_removed_runAgentBridged({
        tools,
        forwardedProps,
      }) as Observable<RuntimeEvent>;
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
