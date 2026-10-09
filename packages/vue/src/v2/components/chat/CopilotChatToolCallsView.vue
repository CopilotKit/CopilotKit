<script setup lang="ts">
import { useSlots } from "vue";
import type { AssistantMessage, Message } from "@ag-ui/core";
import type { CopilotChatToolCallRenderSlotProps } from "./types";
import CopilotChatToolCallItem from "./CopilotChatToolCallItem.vue";

withDefaults(
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
  [key: `tool-call-${string}`]: (
    props: CopilotChatToolCallRenderSlotProps,
  ) => unknown;
}>();

type ToolCallSlotName = "tool-call" | `tool-call-${string}`;
const componentSlots = useSlots() as Record<
  ToolCallSlotName,
  (props?: unknown) => unknown
>;
function getForwardedSlotNames(): ToolCallSlotName[] {
  return Object.keys(componentSlots) as ToolCallSlotName[];
}
</script>

<template>
  <CopilotChatToolCallItem
    v-for="toolCall in message.toolCalls ?? []"
    :key="toolCall.id"
    :tool-call="toolCall"
    :messages="messages"
  >
    <template
      v-for="slotName in getForwardedSlotNames()"
      :key="slotName"
      #[slotName]="slotProps"
    >
      <slot :name="slotName" v-bind="slotProps ?? {}" />
    </template>
  </CopilotChatToolCallItem>
</template>
