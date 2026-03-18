<script setup lang="ts">
import { computed, ref, useSlots, watch } from "vue";
import type {
  ActivityMessage,
  AssistantMessage,
  Message,
  ReasoningMessage,
  ToolMessage,
  UserMessage,
} from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import type { InterruptRenderProps } from "../../types";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import {
  A2UIActivityContentSchema,
  A2UISurfaceActivityType,
} from "../a2ui";
import {
  MCPAppsActivityContentSchema,
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
} from "../MCPAppsActivityRenderer";
import A2UISurfaceActivityRenderer from "../A2UISurfaceActivityRenderer.vue";
import CopilotChatAssistantMessage from "./CopilotChatAssistantMessage.vue";
import CopilotChatReasoningMessage from "./CopilotChatReasoningMessage.vue";
import CopilotChatUserMessage from "./CopilotChatUserMessage.vue";

interface MessageMetaProps {
  message: Message;
  position: "before" | "after";
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: unknown;
}

interface ActivitySlotProps {
  activityType: string;
  content: unknown;
  message: ActivityMessage;
  agent: unknown;
}

type InterruptSlotProps = InterruptRenderProps<unknown, unknown>;

const props = withDefaults(
  defineProps<{
    messages?: Message[];
    isRunning?: boolean;
  }>(),
  {
    messages: () => [],
    isRunning: false,
  },
);

defineSlots<{
  "message-before"?: (props: MessageMetaProps) => unknown;
  "message-after"?: (props: MessageMetaProps) => unknown;
  interrupt?: (props: InterruptSlotProps) => unknown;
  "assistant-message"?: (props: {
    message: AssistantMessage;
    messages: Message[];
    isRunning: boolean;
  }) => unknown;
  "user-message"?: (props: { message: UserMessage }) => unknown;
  "reasoning-message"?: (props: {
    message: ReasoningMessage;
    messages: Message[];
    isRunning: boolean;
  }) => unknown;
  "activity-message"?: (props: ActivitySlotProps) => unknown;
  [key: string]: ((props: any) => unknown) | undefined;
  cursor?: () => unknown;
  "tool-call"?: (props: {
    name: string;
    args: unknown;
    status: string;
    result: string | undefined;
    toolCall: unknown;
    toolMessage: ToolMessage | undefined;
  }) => unknown;
  [key: `tool-call-${string}`]: (props: {
    name: string;
    args: unknown;
    status: string;
    result: string | undefined;
    toolCall: unknown;
    toolMessage: ToolMessage | undefined;
  }) => unknown;
}>();

const { copilotkit, a2uiTheme } = useCopilotKit();
const config = useCopilotChatConfiguration();
const stateTick = ref(0);
const interruptState = ref<InterruptSlotProps | null>(null);
const componentSlots = useSlots() as Record<string, (props?: any) => unknown>;
const forwardedSlotNames = computed(() => Object.keys(componentSlots));

watch(
  [() => config.value?.agentId, () => copilotkit.value],
  ([agentId], _prev, onCleanup) => {
    if (!agentId) return;
    const agent = copilotkit.value.getAgent(agentId);
    if (!agent) return;

    const sub = agent.subscribe({
      onStateChanged: () => {
        stateTick.value += 1;
      },
    });

    onCleanup(() => sub.unsubscribe());
  },
  { immediate: true },
);

watch(
  () => copilotkit.value,
  (core, _previous, onCleanup) => {
    interruptState.value = core.interruptState as InterruptSlotProps | null;
    const sub = core.subscribe({
      onInterruptStateChanged: ({ interruptState: nextInterruptState }) => {
        interruptState.value = nextInterruptState as InterruptSlotProps | null;
      },
      onRuntimeConnectionStatusChanged: () => {
        stateTick.value += 1;
      },
    });

    onCleanup(() => sub.unsubscribe());
  },
  { immediate: true },
);

const resolvedAgentId = computed(
  () => config.value?.agentId ?? DEFAULT_AGENT_ID,
);
const lastMessage = computed(() => props.messages[props.messages.length - 1]);
const showCursor = computed(
  () => props.isRunning && lastMessage.value?.role !== "reasoning",
);

function getMeta(message: Message): Omit<MessageMetaProps, "position" | "message"> {
  stateTick.value += 0;
  const agentId = resolvedAgentId.value;
  const threadId = config.value?.threadId ?? "";
  const core = copilotkit.value;

  const resolvedRunId =
    core.getRunIdForMessage(agentId, threadId, message.id) ??
    core.getRunIdsForThread(agentId, threadId).slice(-1)[0];
  const runId = resolvedRunId ?? `missing-run-id:${message.id}`;

  const agent = core.getAgent(agentId);

  const messageIdsInRun = resolvedRunId && agent
    ? agent.messages
        .filter((msg) => core.getRunIdForMessage(agentId, threadId, msg.id) === resolvedRunId)
        .map((msg) => msg.id)
    : [message.id];

  const rawMessageIndex = agent
    ? agent.messages.findIndex((msg) => msg.id === message.id)
    : -1;
  const messageIndex = rawMessageIndex >= 0 ? rawMessageIndex : 0;
  const messageIndexInRun = resolvedRunId
    ? Math.max(messageIdsInRun.indexOf(message.id), 0)
    : 0;
  const numberOfMessagesInRun = resolvedRunId ? messageIdsInRun.length : 1;
  const stateSnapshot = resolvedRunId
    ? core.getStateByRun(agentId, threadId, resolvedRunId)
    : undefined;

  return {
    runId,
    messageIndex,
    messageIndexInRun,
    numberOfMessagesInRun,
    agentId,
    stateSnapshot,
  };
}

function getActivitySlotName(activityType: string): `activity-${string}` {
  return `activity-${activityType}`;
}

function parseMCPContent(content: unknown) {
  const parsed = MCPAppsActivityContentSchema.safeParse(content);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

function parseA2UIContent(content: unknown) {
  const parsed = A2UIActivityContentSchema.safeParse(content);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

function resolveToolMessage(message: Message, toolCallId: string): ToolMessage | undefined {
  return props.messages.find(
    (candidate) =>
      candidate.role === "tool" && (candidate as ToolMessage).toolCallId === toolCallId,
  ) as ToolMessage | undefined;
}
</script>

<template>
  <div class="flex flex-col" v-bind="$attrs">
    <template v-for="message in messages" :key="message.id">
      <slot
        name="message-before"
        :message="message"
        position="before"
        :run-id="getMeta(message).runId"
        :message-index="getMeta(message).messageIndex"
        :message-index-in-run="getMeta(message).messageIndexInRun"
        :number-of-messages-in-run="getMeta(message).numberOfMessagesInRun"
        :agent-id="getMeta(message).agentId"
        :state-snapshot="getMeta(message).stateSnapshot"
      />

      <slot
        v-if="message.role === 'assistant'"
        name="assistant-message"
        :message="message"
        :messages="messages"
        :is-running="isRunning"
      >
        <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
          <template
            v-for="slotName in forwardedSlotNames"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatAssistantMessage>
      </slot>

      <slot
        v-else-if="message.role === 'user'"
        name="user-message"
        :message="message"
      >
        <CopilotChatUserMessage :message="message">
          <template
            v-for="slotName in forwardedSlotNames"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatUserMessage>
      </slot>

      <slot
        v-else-if="message.role === 'reasoning'"
        name="reasoning-message"
        :message="message"
        :messages="messages"
        :is-running="isRunning"
      >
        <CopilotChatReasoningMessage
          :message="message"
          :messages="messages"
          :is-running="isRunning"
        />
      </slot>

      <slot
        v-else-if="message.role === 'activity'"
        :name="getActivitySlotName(message.activityType)"
        :activity-type="message.activityType"
        :content="message.content"
        :message="message"
        :agent="copilotkit.getAgent(resolvedAgentId)"
      >
        <slot
          name="activity-message"
          :activity-type="message.activityType"
          :content="message.content"
          :message="message"
          :agent="copilotkit.getAgent(resolvedAgentId)"
        >
          <A2UISurfaceActivityRenderer
            v-if="
              message.activityType === A2UISurfaceActivityType &&
              copilotkit.a2uiEnabled &&
              parseA2UIContent(message.content)
            "
            :activity-type="A2UISurfaceActivityType"
            :content="parseA2UIContent(message.content)!"
            :message="message"
            :agent="copilotkit.getAgent(resolvedAgentId)"
            :theme="a2uiTheme"
          />
          <MCPAppsActivityRenderer
            v-if="message.activityType === MCPAppsActivityType && parseMCPContent(message.content)"
            :activity-type="MCPAppsActivityType"
            :content="parseMCPContent(message.content)!"
            :message="message"
            :agent="copilotkit.getAgent(resolvedAgentId)"
          />
        </slot>
      </slot>

      <slot
        name="message-after"
        :message="message"
        position="after"
        :run-id="getMeta(message).runId"
        :message-index="getMeta(message).messageIndex"
        :message-index-in-run="getMeta(message).messageIndexInRun"
        :number-of-messages-in-run="getMeta(message).numberOfMessagesInRun"
        :agent-id="getMeta(message).agentId"
        :state-snapshot="getMeta(message).stateSnapshot"
      />
    </template>

    <slot
      v-if="interruptState"
      name="interrupt"
      :event="interruptState.event"
      :result="interruptState.result"
      :resolve="interruptState.resolve"
    />

    <slot v-if="showCursor" name="cursor">
      <div
        class="w-[11px] h-[11px] rounded-full bg-foreground animate-pulse ml-1"
        data-testid="copilot-chat-cursor"
      />
    </slot>
  </div>
</template>
