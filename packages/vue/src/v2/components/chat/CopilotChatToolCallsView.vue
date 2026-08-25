<script setup lang="ts">
import { inject, useSlots } from "vue";
import type { AssistantMessage, Message } from "@ag-ui/core";
import type { CopilotChatToolCallRenderSlotProps } from "./types";
import CopilotChatToolCallItem from "./CopilotChatToolCallItem.vue";
import SaveSnippetBeside from "./SaveSnippetBeside.vue";
import { InspectorKey } from "../../providers/keys";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import { IconBookmark } from "../icons";

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

// A streaming tool call has truncated arguments. Do not offer to capture it
// until the JSON is complete, or the snippet holds a broken partial payload.
function hasCompleteArgs(args: string | undefined): boolean {
  const trimmed = (args ?? "").trim();
  if (!trimmed) {
    return true;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

const inspector = inject(InspectorKey, null);
const chatConfiguration = useCopilotChatConfiguration();
const canSave = (toolCall: { function: { arguments: string } }) =>
  inspector?.isInspectorEnabled.value === true &&
  hasCompleteArgs(toolCall.function.arguments);
const saveLabel = () =>
  chatConfiguration.value?.labels.assistantMessageToolbarSaveSnippetLabel ??
  CopilotChatDefaultLabels.assistantMessageToolbarSaveSnippetLabel;

function saveToolCall(toolCall: {
  id: string;
  function: { name: string; arguments: string };
}) {
  void inspector?.saveEventSnippet({
    kind: "tool-call",
    messageId: props.message.id,
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    argsJson: toolCall.function.arguments || "{}",
    threadId: chatConfiguration.value?.threadId,
    agentId: chatConfiguration.value?.agentId,
  });
}
</script>

<template>
  <div v-for="toolCall in message.toolCalls ?? []" :key="toolCall.id">
    <SaveSnippetBeside :enabled="canSave(toolCall)">
      <CopilotChatToolCallItem :tool-call="toolCall" :messages="messages">
        <template
          v-for="slotName in getForwardedSlotNames()"
          :key="slotName"
          #[slotName]="slotProps"
        >
          <slot :name="slotName" v-bind="slotProps ?? {}" />
        </template>
      </CopilotChatToolCallItem>
      <template #save>
        <button
          type="button"
          class="cpk:inline-flex cpk:h-8 cpk:w-8 cpk:items-center cpk:justify-center cpk:rounded-md cpk:p-0 cpk:text-[rgb(93,93,93)] cpk:hover:bg-[#E8E8E8] cpk:dark:text-[rgb(243,243,243)] cpk:dark:hover:bg-[#303030]"
          data-testid="copilot-tool-save-snippet-button"
          :aria-label="`${saveLabel()} (Development Only)`"
          @click="saveToolCall(toolCall)"
        >
          <IconBookmark class="cpk:size-[18px]" />
        </button>
      </template>
    </SaveSnippetBeside>
  </div>
</template>
