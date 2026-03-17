<script setup lang="ts">
import type { AssistantMessage, Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import { ToolCallStatus } from "@copilotkitnext/core";
import { partialJSONParse } from "@copilotkitnext/shared";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import type { CopilotChatToolCallRenderSlotProps } from "./types";
import type { VueToolCallRenderer } from "../../types";
import type { VueToolCallRendererRenderProps } from "../../types";

const props = withDefaults(
  defineProps<{
    message: AssistantMessage;
    messages?: Message[];
  }>(),
  {
    messages: () => [],
  },
);

defineSlots<{
  "tool-call"?: (props: CopilotChatToolCallRenderSlotProps) => unknown;
  [key: `tool-call-${string}`]: (props: CopilotChatToolCallRenderSlotProps) => unknown;
}>();

const { copilotkit, executingToolCallIds } = useCopilotKit();
const config = useCopilotChatConfiguration();

function findToolMessage(toolCallId: string): ToolMessage | undefined {
  return props.messages.find(
    (message) => message.role === "tool" && (message as ToolMessage).toolCallId === toolCallId,
  ) as ToolMessage | undefined;
}

function getSlotName(toolName: string): `tool-call-${string}` {
  return `tool-call-${toolName}`;
}

function getRenderProps(toolCall: ToolCall): CopilotChatToolCallRenderSlotProps {
  const toolMessage = findToolMessage(toolCall.id);
  const parsedArgs = partialJSONParse(toolCall.function.arguments);

  if (toolMessage) {
    return {
      name: toolCall.function.name,
      args: parsedArgs,
      status: ToolCallStatus.Complete,
      result: toolMessage.content,
      toolCall,
      toolMessage,
    };
  }

  const isExecuting = executingToolCallIds.value.has(toolCall.id);
  return {
    name: toolCall.function.name,
    args: parsedArgs,
    status: isExecuting ? ToolCallStatus.Executing : ToolCallStatus.InProgress,
    result: undefined,
    toolCall,
    toolMessage: undefined,
  };
}

function getCoreRenderProps(toolCall: ToolCall): VueToolCallRendererRenderProps<unknown> {
  const toolMessage = findToolMessage(toolCall.id);
  const parsedArgs = partialJSONParse(toolCall.function.arguments);

  if (toolMessage) {
    return {
      name: toolCall.function.name,
      args: parsedArgs,
      status: ToolCallStatus.Complete,
      result: toolMessage.content,
    };
  }

  const isExecuting = executingToolCallIds.value.has(toolCall.id);
  if (isExecuting) {
    return {
      name: toolCall.function.name,
      args: parsedArgs,
      status: ToolCallStatus.Executing,
      result: undefined,
    };
  }

  return {
    name: toolCall.function.name,
    args:
      parsedArgs && typeof parsedArgs === "object"
        ? parsedArgs
        : {},
    status: ToolCallStatus.InProgress,
    result: undefined,
  };
}

function getCoreRenderConfig(toolCall: ToolCall): VueToolCallRenderer<unknown> | undefined {
  const renderToolCalls = copilotkit.value.renderToolCalls;
  const agentId = config.value?.agentId ?? DEFAULT_AGENT_ID;
  const exactMatches = renderToolCalls.filter(
    (renderConfig) => renderConfig.name === toolCall.function.name,
  );

  return exactMatches.find((renderConfig) => renderConfig.agentId === agentId)
    ?? exactMatches.find((renderConfig) => !renderConfig.agentId)
    ?? exactMatches[0]
    ?? renderToolCalls.find((renderConfig) => renderConfig.name === "*");
}
</script>

<template>
  <template v-for="toolCall in (message.toolCalls ?? [])" :key="toolCall.id">
    <slot :name="getSlotName(toolCall.function.name)" v-bind="getRenderProps(toolCall)">
      <slot name="tool-call" v-bind="getRenderProps(toolCall)">
        <component
          :is="getCoreRenderConfig(toolCall)?.render"
          v-if="getCoreRenderConfig(toolCall)"
          v-bind="getCoreRenderProps(toolCall)"
        />
      </slot>
    </slot>
  </template>
</template>
