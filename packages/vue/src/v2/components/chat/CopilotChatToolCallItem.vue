<script setup lang="ts">
import type { Message, ToolCall } from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import type { CopilotChatToolCallRenderSlotProps } from "./types";
import {
  getCoreRenderConfig,
  getCoreRenderProps,
  getToolCallMemoDeps,
  getToolCallRenderProps,
  getToolCallSlotName,
} from "./copilotChatToolCallItemRender";

const props = withDefaults(
  defineProps<{
    toolCall: ToolCall;
    messages?: Message[];
  }>(),
  {
    messages: () => [],
  },
);

defineSlots<{
  "tool-call"?: (props: CopilotChatToolCallRenderSlotProps) => unknown;
  [key: `tool-call-${string}`]: (
    props: CopilotChatToolCallRenderSlotProps,
  ) => unknown;
}>();

const { copilotkit, executingToolCallIds } = useCopilotKit();
const config = useCopilotChatConfiguration();

function getRenderProps(): CopilotChatToolCallRenderSlotProps {
  return getToolCallRenderProps(
    props.toolCall,
    props.messages,
    executingToolCallIds.value,
  );
}

function getCoreProps() {
  return getCoreRenderProps(
    props.toolCall,
    props.messages,
    executingToolCallIds.value,
  );
}

function getRenderConfig() {
  const agentId = config.value?.agentId ?? DEFAULT_AGENT_ID;
  return getCoreRenderConfig(
    props.toolCall,
    copilotkit.value.renderToolCalls,
    agentId,
  );
}

function getMemoDeps() {
  const agentId = config.value?.agentId ?? DEFAULT_AGENT_ID;
  return getToolCallMemoDeps(
    props.toolCall,
    props.messages,
    executingToolCallIds.value,
    copilotkit.value.renderToolCalls,
    agentId,
  );
}
</script>

<template>
  <slot
    :name="getToolCallSlotName(toolCall.function.name)"
    v-bind="getRenderProps()"
  >
    <slot name="tool-call" v-bind="getRenderProps()">
      <component
        :is="getRenderConfig()?.render"
        v-if="getRenderConfig()"
        v-memo="getMemoDeps()"
        v-bind="getCoreProps()"
      />
    </slot>
  </slot>
</template>
