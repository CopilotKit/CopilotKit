<script setup lang="ts">
import { inject, useSlots } from "vue";
import type { AssistantMessage, Message } from "@ag-ui/core";
import type { CopilotChatToolCallRenderSlotProps } from "./types";
import CopilotChatToolCallItem from "./CopilotChatToolCallItem.vue";
import CopilotChatSubagentGroup, {
  SubagentLayoutKey,
} from "./CopilotChatSubagentGroup";

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

// The subagents a tool call started render right after it, even when no
// renderer is registered for the call.
const subagentLayout = inject(SubagentLayoutKey, null);
function groupsFor(toolCallId: string) {
  return subagentLayout?.value.layout.byToolCallId.get(toolCallId) ?? [];
}
</script>

<template>
  <template v-for="toolCall in message.toolCalls ?? []" :key="toolCall.id">
    <CopilotChatToolCallItem :tool-call="toolCall" :messages="messages">
      <template
        v-for="slotName in getForwardedSlotNames()"
        :key="slotName"
        #[slotName]="slotProps"
      >
        <slot :name="slotName" v-bind="slotProps ?? {}" />
      </template>
    </CopilotChatToolCallItem>
    <CopilotChatSubagentGroup
      v-for="group in groupsFor(toolCall.id)"
      :key="`subagent-${group.subagentRunId}`"
      :group="group"
    />
  </template>
</template>
