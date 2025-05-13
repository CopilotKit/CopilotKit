import { Logger } from "pino";
import { Observable } from "rxjs";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";
import { Message } from "../../graphql/types/converted";
import { RuntimeEvent } from "../../service-adapters/events";
import telemetry from "../telemetry-client";
import { RemoteAgentHandlerParams } from "./remote-actions";

import {
  AssistantMessage as AgentWireAssistantMessage,
  Message as AgentWireMessage,
  ToolCall,
} from "@ag-ui/client";

import { AbstractAgent } from "@ag-ui/client";
import { parseJson } from "@copilotkit/shared";

export function constructAgentWireRemoteAction({
  logger,
  messages,
  agentStates,
  agent,
}: {
  logger: Logger;
  messages: Message[];
  agentStates?: AgentStateInput[];
  agent: AbstractAgent;
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

      const agentWireMessages = convertMessagesToAgentWire(messages);
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

      return agent.legacy_to_be_removed_runAgentBridged({
        tools,
      }) as Observable<RuntimeEvent>;
    },
  };
  return [action];
}

export function convertMessagesToAgentWire(messages: Message[]): AgentWireMessage[] {
  const result: AgentWireMessage[] = [];

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
        const parentMessage: AgentWireAssistantMessage | undefined = result.find(
          (m) => m.id === message.parentMessageId,
        ) as AgentWireAssistantMessage;
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
