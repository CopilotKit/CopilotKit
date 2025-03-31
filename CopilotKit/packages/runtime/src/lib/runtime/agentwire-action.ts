import { createHash } from "node:crypto";
import { CopilotKitEndpoint, RemoteAgentHandlerParams } from "./remote-actions";
import { GraphQLContext } from "../integrations";
import { Logger } from "pino";
import { Message } from "../../graphql/types/converted";
import { AgentStateInput } from "../../graphql/inputs/agent-state.input";
import { Observable } from "rxjs";
import { RuntimeEvent } from "../../service-adapters/events";
import telemetry from "../telemetry-client";

import { ToolCall } from "@agentwire/client";
import { Message as AgentWireMessage } from "@agentwire/client";

import { parseJson } from "@copilotkit/shared";
import { AbstractAgent } from "@agentwire/client";

export function constructAgentWireRemoteAction({
  logger,
  messages,
  agentStates,
  agent,
}: {
  logger: Logger;
  messages: Message[];
  agentStates?: AgentStateInput[];
  agent: AbstractAgent<any>;
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

      agent.tools = tools;

      return agent.legacy_to_be_removed_runAgentBridged() as Observable<RuntimeEvent>;
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
        role: message.role,
        content: message.content,
        tool_calls: [],
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
        result.find((m) => m.id === message.parentMessageId)?.tool_calls.push(toolCall);
      } else {
        result.push({
          id: message.parentMessageId ?? message.id,
          role: "assistant",
          tool_calls: [toolCall],
        });
      }
    } else if (message.isResultMessage()) {
      result.push({
        id: message.id,
        role: "tool",
        content: message.result,
      });
    }
  }
  return result;
}
