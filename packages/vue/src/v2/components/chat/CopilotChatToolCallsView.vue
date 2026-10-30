<script setup lang="ts">
import { computed, h, inject, useSlots } from "vue";
import type { Slots, VNode } from "vue";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { useCopilotKit } from "../../providers/useCopilotKit";
import type {
  CopilotChatToolCallGroupAppearance,
  CopilotChatToolCallRenderSlotProps,
  CopilotChatToolCallsGroupSlotProps,
} from "./types";
import CopilotChatToolCallItem from "./CopilotChatToolCallItem.vue";
import CopilotChatToolCallGroup from "./CopilotChatToolCallGroup.vue";
import { ToolCallDisplayContextKey } from "./tool-call-display-context";
import {
  getToolCallLayouts,
  getToolCallRendererNames,
} from "./tool-call-layout";
import type {
  CopilotChatToolCallDisplay,
  ToolCallEntry,
} from "./tool-call-layout";

const props = withDefaults(
  defineProps<{
    message: AssistantMessage;
    messages?: Message[];
    /**
     * How to show the calls (see `CopilotChatToolCallDisplay`). Inside a
     * message view it follows the view's `toolCallDisplay`; on its own it
     * defaults to `"grouped"`.
     */
    display?: CopilotChatToolCallDisplay;
  }>(),
  {
    messages: () => [],
    display: undefined,
  },
);

defineSlots<{
  "tool-call"?: (props: CopilotChatToolCallRenderSlotProps) => unknown;
  /** Replaces a group of calls made in a row. */
  "tool-calls-group"?: (props: CopilotChatToolCallsGroupSlotProps) => unknown;
  [key: `tool-call-${string}`]: (
    props: CopilotChatToolCallRenderSlotProps,
  ) => unknown;
}>();

type ToolCallSlotName = "tool-call" | `tool-call-${string}`;

const appearances: Partial<
  Record<CopilotChatToolCallDisplay, CopilotChatToolCallGroupAppearance>
> = {
  grouped: "card",
  line: "line",
  stacked: "stack",
};

const componentSlots = useSlots() as Slots;
const { copilotkit } = useCopilotKit();
const context = inject(ToolCallDisplayContextKey, null);

/** The slots that draw tool calls, which each call's item renders. */
function getToolCallSlotNames(): ToolCallSlotName[] {
  return Object.keys(componentSlots).filter(
    (name): name is ToolCallSlotName =>
      name === "tool-call" || name.startsWith("tool-call-"),
  );
}

const display = computed(
  () => props.display ?? context?.value.display ?? "grouped",
);

// Inside a message view, groups can span messages, so the view lays them out
// for the whole list; on its own, this message's calls are grouped.
const layout = computed(() => {
  if (display.value === "separate") return undefined;
  const viewLayout = context?.value.layouts.get(props.message.id);
  if (viewLayout) return viewLayout;
  const rendererNames = getToolCallRendererNames(
    copilotkit.value.renderToolCalls,
    getToolCallSlotNames(),
  );
  return getToolCallLayouts([props.message], props.messages, rendererNames).get(
    props.message.id,
  );
});

// Whether the agent may still finish a trailing group's calls. Without a
// message view there's no run state, so a call with no result is assumed to
// be running, as the built-in card has always shown it.
const groupActive = (trailing: boolean) =>
  trailing && (context ? context.value.isRunning : true);

const appearance = computed(() => appearances[display.value] ?? "card");

/** Draws one call through the registered renderers and tool-call slots. */
function renderCall(call: ToolCallEntry): VNode {
  const slots: Record<string, Slots[string]> = {};
  for (const name of getToolCallSlotNames()) slots[name] = componentSlots[name];
  return h(
    CopilotChatToolCallItem,
    {
      key: call.toolCall.id,
      toolCall: call.toolCall,
      messages: props.messages,
    },
    slots,
  );
}
</script>

<template>
  <template v-if="!layout">
    <CopilotChatToolCallItem
      v-for="toolCall in message.toolCalls ?? []"
      :key="toolCall.id"
      :tool-call="toolCall"
      :messages="messages"
    >
      <template
        v-for="slotName in getToolCallSlotNames()"
        :key="slotName"
        #[slotName]="slotProps"
      >
        <slot :name="slotName" v-bind="slotProps ?? {}" />
      </template>
    </CopilotChatToolCallItem>
  </template>
  <template v-else>
    <template v-for="segment in layout.segments" :key="segment.id">
      <CopilotChatToolCallItem
        v-if="segment.kind === 'call'"
        :tool-call="segment.call.toolCall"
        :messages="messages"
      >
        <template
          v-for="slotName in getToolCallSlotNames()"
          :key="slotName"
          #[slotName]="slotProps"
        >
          <slot :name="slotName" v-bind="slotProps ?? {}" />
        </template>
      </CopilotChatToolCallItem>
      <slot
        v-else
        name="tool-calls-group"
        :calls="segment.calls"
        :appearance="appearance"
        :is-active="groupActive(segment.trailing)"
        :render-call="renderCall"
      >
        <CopilotChatToolCallGroup
          :calls="segment.calls"
          :appearance="appearance"
          :is-active="groupActive(segment.trailing)"
        >
          <template #call="{ call }">
            <component :is="renderCall(call)" />
          </template>
        </CopilotChatToolCallGroup>
      </slot>
    </template>
  </template>
</template>
